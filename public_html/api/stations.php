<?php
/**
 * Station directory and owner management.
 *
 * GET  ?action=public                  -> { stations }  listed stations, for everyone
 * GET  ?action=mine                    -> { stations }  the signed-in user's stations
 * GET  ?action=check-slug&slug=..&id=  -> { available } whether a URL name is free (signed in only)
 * POST { action: "save", id?, ... }    -> { station }   create, or update one you own
 * POST { action: "delete", id }
 *
 * A URL name someone else already holds is refused with 409. Saves are rate
 * limited per user, since each one that touches the keys calls Ambient.
 */

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/ambient.php';
require_once BACKEND_DIR . '/backfill.php';

/** Saves allowed per user in STATION_SAVE_RATE_WINDOW seconds. */
const STATION_SAVE_RATE_MAX = 20;
const STATION_SAVE_RATE_WINDOW = 3600;

const SLUG_TAKEN = 'That URL name is already taken';

// The public directory is read by anonymous visitors, who need no session file.
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    start_session_if_cookie();
} else {
    start_session();
}
$pdo = get_db_connection();

function find_owned_station(PDO $pdo, int $id, int $user_id): array {
    $stmt = $pdo->prepare('SELECT * FROM stations WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $user_id]);
    $station = $stmt->fetch();
    if (!$station) {
        fail('Station not found', 404);
    }
    return $station;
}

function count_user_stations(PDO $pdo, int $user_id): int {
    $count = $pdo->prepare('SELECT COUNT(*) FROM stations WHERE user_id = :uid');
    $count->execute([':uid' => $user_id]);
    return (int)$count->fetchColumn();
}

/** Whether a failed write broke the UNIQUE constraint on stations.slug. */
function is_slug_collision(PDOException $e): bool {
    return str_contains($e->getMessage(), 'UNIQUE') && str_contains($e->getMessage(), 'stations.slug');
}

/**
 * The normalized MAC of the device an existing station has been recording, or
 * null if that cannot be told. A station saved without a MAC used the single
 * device its key had, so that is looked up with the key it was saved with.
 * $devices is the device list already fetched for the new settings, reused
 * when the keys have not changed rather than asking Ambient twice.
 */
function previous_device_mac(array $existing, string $new_api_key, string $new_app_key, array $devices): ?string {
    $stored = normalize_mac($existing['mac_address']);
    if ($stored !== '') {
        return $stored;
    }
    if ($existing['api_key'] !== $new_api_key || $existing['application_key'] !== $new_app_key) {
        usleep(1_100_000); // Ambient allows one request per second
        [$devices, $error] = ambient_fetch_devices($existing['api_key'], $existing['application_key']);
        if ($error) {
            return null;
        }
    }
    [$device, $error] = ambient_pick_device($devices, '');
    $mac = $error ? '' : normalize_mac($device['macAddress'] ?? '');
    return $mac !== '' ? $mac : null;
}

/**
 * Empties a station whose settings now point at a different physical device.
 * Its readings and summaries describe the old one, and so does its history
 * walk and its time zone, so all of that starts over for the new device.
 * Must run inside the save's transaction.
 */
function reset_station_history(PDO $pdo, int $station_id): void {
    $pdo->prepare('DELETE FROM readings WHERE station_id = :id')->execute([':id' => $station_id]);
    $pdo->prepare('DELETE FROM daily_summaries WHERE station_id = :id')->execute([':id' => $station_id]);
    $pdo->prepare('UPDATE stations SET backfill_cursor = NULL, backfill_complete = 0, gap_checked_to = NULL,
            timezone = NULL WHERE id = :id')
        ->execute([':id' => $station_id]);
}

function save_station(PDO $pdo, int $user_id, array $body): never {
    rate_limit($pdo, "station-save:$user_id", STATION_SAVE_RATE_MAX, STATION_SAVE_RATE_WINDOW);
    $existing = !empty($body['id']) ? find_owned_station($pdo, (int)$body['id'], $user_id) : null;

    // Checked early to spare the call to Ambient, and again under the write lock below.
    if (!$existing && count_user_stations($pdo, $user_id) >= MAX_STATIONS_PER_USER) {
        fail('You can register up to ' . MAX_STATIONS_PER_USER . ' stations');
    }

    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 60) {
        fail('Station name is required (60 characters max)');
    }

    $slug = strtolower(trim((string)($body['slug'] ?? '')));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{2,39}$/', $slug) || in_array($slug, RESERVED_SLUGS, true)) {
        fail('Choose a URL name of 3-40 lowercase letters, numbers or dashes');
    }
    $taken = $pdo->prepare('SELECT 1 FROM stations WHERE slug = :slug AND id != :id');
    $taken->execute([':slug' => $slug, ':id' => $existing['id'] ?? 0]);
    if ($taken->fetchColumn()) {
        fail(SLUG_TAKEN, 409);
    }

    $api_key = trim((string)($body['api_key'] ?? ''));
    if ($api_key === '' && !$existing) {
        fail('Your Ambient Weather API key is required');
    }
    $final_api_key = $api_key !== '' ? $api_key : $existing['api_key'];

    $app_key = trim((string)($body['application_key'] ?? ''));
    if ($app_key === '' && (!$existing || $existing['application_key'] === '')) {
        fail('Your Ambient Weather Application key is required');
    }
    $final_app_key = $app_key !== '' ? $app_key : $existing['application_key'];

    $mac = trim((string)($body['mac_address'] ?? ''));
    if ($mac !== '' && strlen(normalize_mac($mac)) !== 12) {
        fail('MAC address should look like 00:0E:C6:12:34:56');
    }

    $lat = $body['latitude'] ?? null;
    $lon = $body['longitude'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lon) || abs((float)$lat) > 90 || abs((float)$lon) > 180) {
        fail('A valid latitude and longitude are required for the forecast');
    }

    $forecast_provider = (string)($body['forecast_provider'] ?? 'auto');
    if (!in_array($forecast_provider, FORECAST_PROVIDERS, true)) {
        fail('Choose a forecast source of ' . implode(', ', FORECAST_PROVIDERS));
    }

    // Check the key and device with Ambient before saving anything
    $device = null;
    $device_changed = false;
    $connection_changed = !$existing || $api_key !== '' || $app_key !== '' || normalize_mac($mac) !== normalize_mac($existing['mac_address']);
    if ($connection_changed) {
        [$devices, $error] = ambient_fetch_devices($final_api_key, $final_app_key);
        if (!$error) {
            [$device, $error] = ambient_pick_device($devices, $mac);
        }
        if ($error) {
            fail($error, 422);
        }
        // Compare the physical devices, not the MAC text: typing in the MAC of
        // the one device a blank-MAC station was already using changes nothing.
        // When the old device cannot be told, keep the data rather than guess.
        if ($existing) {
            $old_mac = previous_device_mac($existing, $final_api_key, $final_app_key, $devices);
            $new_mac = normalize_mac($device['macAddress'] ?? '');
            $device_changed = $old_mac !== null && $new_mac !== '' && $new_mac !== $old_mac;
        }
    }

    $params = [
        ':slug' => $slug,
        ':name' => $name,
        ':api_key' => $final_api_key,
        ':app_key' => $final_app_key,
        ':mac' => $mac,
        ':lat' => (float)$lat,
        ':lon' => (float)$lon,
        ':forecast_provider' => $forecast_provider,
        ':public' => !empty($body['is_public']) ? 1 : 0,
    ];

    try {
        // IMMEDIATE, so two saves at once cannot both count four stations and
        // both insert a fifth: the second waits here and counts again.
        $id = immediate_transaction($pdo, function () use ($pdo, $existing, $params, $user_id, $connection_changed, $device_changed) {
            if ($existing) {
                // Keys that were just accepted by Ambient clear the old error,
                // and with it cron's hourly backoff for rejected keys.
                $clear_error = $connection_changed ? ', last_poll_error = NULL' : '';
                $pdo->prepare("UPDATE stations SET slug = :slug, name = :name, api_key = :api_key, application_key = :app_key,
                        mac_address = :mac, latitude = :lat, longitude = :lon, forecast_provider = :forecast_provider,
                        is_public = :public$clear_error WHERE id = :id")
                    ->execute($params + [':id' => $existing['id']]);
                if ($device_changed) {
                    reset_station_history($pdo, (int)$existing['id']);
                }
                return (int)$existing['id'];
            }
            if (count_user_stations($pdo, $user_id) >= MAX_STATIONS_PER_USER) {
                return null;
            }
            $pdo->prepare('INSERT INTO stations (user_id, slug, name, api_key, application_key, mac_address, latitude, longitude, forecast_provider, is_public)
                    VALUES (:uid, :slug, :name, :api_key, :app_key, :mac, :lat, :lon, :forecast_provider, :public)')
                ->execute($params + [':uid' => $user_id]);
            return (int)$pdo->lastInsertId();
        });
    } catch (PDOException $e) {
        // Someone took the name between the check above and this write.
        if (is_slug_collision($e)) {
            fail(SLUG_TAKEN, 409);
        }
        throw $e;
    }
    if ($id === null) {
        fail('You can register up to ' . MAX_STATIONS_PER_USER . ' stations');
    }

    $station = find_owned_station($pdo, $id, $user_id);
    if ($device && !empty($device['lastData'])) {
        ingest_device($pdo, $station, $device);
        $station = find_owned_station($pdo, $id, $user_id);
    }
    if (!$existing || $device_changed) {
        // Detached, so the owner gets their station back straight away while
        // the year of history fills in behind them.
        start_backfill_async($id);
    }
    send_json(['station' => station_owner_view($station)]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'public';

    if ($action === 'public') {
        $rows = $pdo->query('SELECT s.*, r.tempf AS latest_tempf, r.recorded_at AS latest_at
            FROM stations s
            LEFT JOIN readings r ON r.station_id = s.id
                AND r.recorded_at = (SELECT MAX(recorded_at) FROM readings WHERE station_id = s.id)
            WHERE s.is_public = 1
            ORDER BY s.name COLLATE NOCASE')->fetchAll();
        send_json(['stations' => array_map(fn($row) => [
            'slug' => $row['slug'],
            'name' => $row['name'],
            'tempf' => num_or_null($row['latest_tempf']),
            'lastUpdated' => utc_to_iso($row['latest_at']),
        ], $rows)]);
    }

    if ($action === 'mine') {
        $stmt = $pdo->prepare('SELECT * FROM stations WHERE user_id = :uid ORDER BY created_at');
        $stmt->execute([':uid' => require_user()]);
        send_json(['stations' => array_map('station_owner_view', $stmt->fetchAll())]);
    }

    if ($action === 'check-slug') {
        // Only someone setting up a station needs this; for anyone else it
        // would just be a way to list which station names exist.
        require_user();
        $slug = strtolower(trim((string)($_GET['slug'] ?? '')));
        if (!preg_match('/^[a-z0-9][a-z0-9-]{2,39}$/', $slug) || in_array($slug, RESERVED_SLUGS, true)) {
            send_json(['available' => false]);
        }
        $taken = $pdo->prepare('SELECT 1 FROM stations WHERE slug = :slug AND id != :id');
        $taken->execute([':slug' => $slug, ':id' => (int)($_GET['id'] ?? 0)]);
        send_json(['available' => !$taken->fetchColumn()]);
    }

    fail('Unknown action', 404);
}

$body = request_body();
$user_id = require_user();

switch ($body['action'] ?? '') {
    case 'save':
        save_station($pdo, $user_id, $body);

    case 'delete':
        $station = find_owned_station($pdo, (int)($body['id'] ?? 0), $user_id);
        $pdo->prepare('DELETE FROM stations WHERE id = :id')->execute([':id' => $station['id']]);
        send_json(['ok' => true]);

    default:
        fail('Unknown action', 404);
}
