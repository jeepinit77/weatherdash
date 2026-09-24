<?php
/**
 * GET ?slug=...         -> { station, reading, stats }   reading is null until the first poll succeeds
 * GET ?slug=...&live=1   -> the same, after asking Ambient for a reading now (the station's owner only)
 *
 * The cron job polls every 5 minutes; `live` is what the Refresh button uses so
 * it fetches something newer instead of redrawing the same numbers. Each live
 * poll spends the owner's Ambient rate limit, so only the signed-in owner may
 * ask for one; for anyone else `live` is ignored and the stored data is served.
 *
 * `station.isOwner` tells the page whether the viewer is that owner, so it can
 * offer Refresh only where it would do something.
 */

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/stats.php';
require_once BACKEND_DIR . '/ambient.php';

/** Don't poll Ambient more often than this, however often Refresh is pressed. */
const LIVE_POLL_MIN_SECONDS = 60;

$pdo = get_db_connection();
$station = require_station_from_query($pdo);

// Only a browser that already has a session can be the owner, so anonymous
// visitors never get a session file. The session is released straight away:
// nothing below writes to it, and holding it would queue this user's other
// requests behind a slow call to Ambient.
start_session_if_cookie();
$user_id = current_user_id();
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
$is_owner = $user_id !== null && (int)$station['user_id'] === $user_id;

if ($is_owner && !empty($_GET['live']) && claim_poll_slot($pdo, (int)$station['id'], LIVE_POLL_MIN_SECONDS)) {
    poll_station($pdo, $station);
    $station = find_station_by_slug($pdo, $station['slug']) ?? $station;
}

$stmt = $pdo->prepare('SELECT * FROM readings WHERE station_id = :id ORDER BY recorded_at DESC LIMIT 1');
$stmt->execute([':id' => $station['id']]);
$row = $stmt->fetch();

$reading = null;
if ($row) {
    $reading = ['date' => utc_to_iso($row['recorded_at'])];
    foreach ([
        'tempf' => 'tempf', 'feelsLike' => 'feels_like', 'dewPoint' => 'dew_point', 'humidity' => 'humidity',
        'tempinf' => 'temp_in', 'humidityin' => 'humidity_in', 'baromrelin' => 'barom_rel', 'baromabsin' => 'barom_abs',
        'windspeedmph' => 'wind_speed', 'windgustmph' => 'wind_gust', 'maxdailygust' => 'max_daily_gust', 'winddir' => 'wind_dir',
        'hourlyrainin' => 'hourly_rain', 'dailyrainin' => 'daily_rain', 'weeklyrainin' => 'weekly_rain',
        'monthlyrainin' => 'monthly_rain', 'totalrainin' => 'total_rain', 'solarradiation' => 'solar_radiation',
        'uv' => 'uv', 'battout' => 'batt_out', 'eventrainin' => 'event_rain', 'yearlyrainin' => 'yearly_rain',
        'feelsLikein' => 'feels_like_in', 'dewPointin' => 'dew_point_in',
    ] as $key => $column) {
        $reading[$key] = num_or_null($row[$column]);
    }
    $reading['lastRain'] = $row['last_rain'] === null ? null : gmdate('Y-m-d\TH:i:s\Z', (int)$row['last_rain']);
}

send_json([
    // Rounded to a tenth of a degree (about 11 km): plenty for the moon's rise and
    // set, and no more exact than the forecast for the station already gives away.
    'station' => station_public_view($station) + [
        'isOwner' => $is_owner,
        'approxLatitude' => round((float)$station['latitude'], 1),
        'approxLongitude' => round((float)$station['longitude'], 1),
    ],
    'reading' => $reading,
    'stats' => station_stats($pdo, $station),
]);
