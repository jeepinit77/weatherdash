<?php
/**
 * Ambient Weather API client and reading ingestion.
 * https://ambientweather.docs.apiary.io/
 */

require_once __DIR__ . '/config.php';

/** readings column => Ambient lastData field */
const READING_FIELDS = [
    'tempf' => 'tempf',
    'feels_like' => 'feelsLike',
    'dew_point' => 'dewPoint',
    'humidity' => 'humidity',
    'temp_in' => 'tempinf',
    'humidity_in' => 'humidityin',
    'barom_rel' => 'baromrelin',
    'barom_abs' => 'baromabsin',
    'wind_speed' => 'windspeedmph',
    'wind_gust' => 'windgustmph',
    'max_daily_gust' => 'maxdailygust',
    'wind_dir' => 'winddir',
    'hourly_rain' => 'hourlyrainin',
    'daily_rain' => 'dailyrainin',
    'weekly_rain' => 'weeklyrainin',
    'monthly_rain' => 'monthlyrainin',
    'total_rain' => 'totalrainin',
    'solar_radiation' => 'solarradiation',
    'uv' => 'uv',
    'batt_out' => 'battout',
    'event_rain' => 'eventrainin',
    'yearly_rain' => 'yearlyrainin',
    'feels_like_in' => 'feelsLikein',
    'dew_point_in' => 'dewPointin',
    'last_rain' => 'lastRain',
];

/** The readings columns declared INTEGER; every other reading column is REAL. */
const READING_INTEGER_COLUMNS = ['wind_dir', 'uv', 'batt_out'];

/** Columns Ambient sends as an ISO 8601 time, kept as unix seconds. */
const READING_TIME_COLUMNS = ['last_rain'];

/** What Ambient's 401/403 means. poll_backoff_active() looks for exactly this text. */
const AMBIENT_KEYS_REJECTED = 'Ambient Weather rejected the API key or Application key';

/** How often cron retries a station whose keys Ambient has rejected. */
const REJECTED_KEYS_RETRY_SECONDS = 3600;

/**
 * Ambient requires two keys per request, both created on the owner's ambientweather.net account page:
 * the API key (grants access to their devices) and the Application key (identifies the app).
 *
 * @return array{0: ?array, 1: ?string} [devices, error]
 */
function ambient_fetch_devices(string $api_key, string $app_key, bool $retry = true): array {
    $url = 'https://rt.ambientweather.net/v1/devices?' . http_build_query([
        'apiKey' => $api_key,
        'applicationKey' => $app_key,
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => 'WeatherDash/1.0',
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false) {
        return [null, 'Could not reach Ambient Weather'];
    }
    if ($code === 401 || $code === 403) {
        return [null, AMBIENT_KEYS_REJECTED];
    }
    if ($code === 429) {
        if ($retry) {
            sleep(5);
            return ambient_fetch_devices($api_key, $app_key, false);
        }
        return [null, 'Ambient Weather rate limit reached, try again in a minute'];
    }
    if ($code !== 200) {
        return [null, "Ambient Weather returned HTTP $code"];
    }
    $devices = json_decode($resp, true);
    if (!is_array($devices)) {
        return [null, 'Unexpected response from Ambient Weather'];
    }
    return [$devices, null];
}

function normalize_mac(?string $mac): string {
    return strtolower(preg_replace('/[^0-9a-f]/i', '', $mac ?? ''));
}

/** @return array{0: ?array, 1: ?string} [device, error] */
function ambient_pick_device(array $devices, string $mac): array {
    if (!$devices) {
        return [null, 'No devices are registered to this API key'];
    }
    $want = normalize_mac($mac);
    if ($want !== '') {
        foreach ($devices as $device) {
            if (normalize_mac($device['macAddress'] ?? '') === $want) {
                return [$device, null];
            }
        }
        return [null, 'No device with that MAC address is registered to this API key'];
    }
    if (count($devices) > 1) {
        return [null, 'This API key has several devices; enter the MAC address of the one to use'];
    }
    return [$devices[0], null];
}

function valid_timezone(?string $tz): ?string {
    return $tz && in_array($tz, DateTimeZone::listIdentifiers(), true) ? $tz : null;
}

/** Prepared upsert for one row of Ambient data. */
function reading_upsert(PDO $pdo): PDOStatement {
    static $stmt = null;
    if ($stmt === null) {
        $columns = array_keys(READING_FIELDS);
        $updates = implode(', ', array_map(fn($c) => "$c = excluded.$c", $columns));
        $stmt = $pdo->prepare(
            'INSERT INTO readings (station_id, recorded_at, ' . implode(', ', $columns) . ')
             VALUES (:station_id, :recorded_at, :' . implode(', :', $columns) . ')
             ON CONFLICT(station_id, recorded_at) DO UPDATE SET ' . $updates
        );
    }
    return $stmt;
}

/** Stores one Ambient record. Returns its UTC timestamp, or null if it carried no usable time. */
function store_reading(PDO $pdo, int $station_id, array $data): ?string {
    if (!isset($data['dateutc'])) {
        return null;
    }
    $recorded_at = gmdate('Y-m-d H:i:s', intdiv((int)$data['dateutc'], 1000));
    $values = [':station_id' => $station_id, ':recorded_at' => $recorded_at];
    foreach (READING_FIELDS as $column => $field) {
        $value = $data[$field] ?? null;
        if (in_array($column, READING_TIME_COLUMNS, true)) {
            $time = is_string($value) ? strtotime($value) : false;
            $values[":$column"] = $time === false ? null : $time;
        } elseif (!is_numeric($value)) {
            $values[":$column"] = null;
        } elseif (in_array($column, READING_INTEGER_COLUMNS, true)) {
            // Bound as numbers rather than whatever JSON handed over, so a "5"
            // never lands in the table as text and compares as text.
            $values[":$column"] = (int)round((float)$value);
        } else {
            $values[":$column"] = (float)$value;
        }
    }
    reading_upsert($pdo)->execute($values);
    return $recorded_at;
}

/** Stores the device's latest data for a station and refreshes its daily summaries. */
function ingest_device(PDO $pdo, array $station, array $device): void {
    $id = (int)$station['id'];
    $data = $device['lastData'];
    $timezone = valid_timezone($data['tz'] ?? null) ?? $station['timezone'];
    $recorded_at = store_reading($pdo, $id, $data);

    $pdo->prepare('UPDATE stations SET timezone = :tz, last_poll_at = :now, last_poll_error = NULL WHERE id = :id')
        ->execute([':tz' => $timezone, ':now' => gmdate('Y-m-d H:i:s'), ':id' => $id]);

    if ($station['timezone'] === null && $timezone !== null) {
        // Every summary so far was grouped by UTC day; regroup them by local day.
        resummarize_all_days($pdo, $id, $timezone);
        return;
    }
    update_daily_summaries($pdo, $id, $timezone ?? 'UTC', $recorded_at);
}

/**
 * Takes the station's poll slot if nobody has polled it in the last
 * $min_seconds, by stamping last_poll_at in the same statement that checks it.
 * Two Refresh presses arriving together cannot both see "not polled lately"
 * and both call Ambient: only the one whose update matched the row goes ahead.
 */
function claim_poll_slot(PDO $pdo, int $station_id, int $min_seconds): bool {
    $now = time();
    $stmt = $pdo->prepare('UPDATE stations SET last_poll_at = :now
        WHERE id = :id AND (last_poll_at IS NULL OR last_poll_at <= :cutoff)');
    $stmt->execute([
        ':now' => gmdate('Y-m-d H:i:s', $now),
        ':id' => $station_id,
        ':cutoff' => gmdate('Y-m-d H:i:s', $now - $min_seconds),
    ]);
    return $stmt->rowCount() === 1;
}

/**
 * Whether cron should leave a station alone for now. Keys Ambient has rejected
 * stay rejected until the owner edits them, so asking again every five minutes
 * only spends the rate limit; once an hour is enough to notice a key that was
 * re-enabled on Ambient's side. Saving the station with new keys clears the
 * error, and with it the backoff.
 */
function poll_backoff_active(array $station): bool {
    if ($station['last_poll_error'] !== AMBIENT_KEYS_REJECTED || $station['last_poll_at'] === null) {
        return false;
    }
    return time() - strtotime($station['last_poll_at'] . ' UTC') < REJECTED_KEYS_RETRY_SECONDS;
}

/** Fetches and stores the latest reading for one station. Returns null on success or an error message. */
function poll_station(PDO $pdo, array $station): ?string {
    [$devices, $error] = ambient_fetch_devices($station['api_key'], $station['application_key']);
    if (!$error) {
        [$device, $error] = ambient_pick_device($devices, $station['mac_address']);
    }
    if (!$error && empty($device['lastData'])) {
        $error = 'The device has not reported any data yet';
    }
    if ($error) {
        $pdo->prepare('UPDATE stations SET last_poll_at = :now, last_poll_error = :err WHERE id = :id')
            ->execute([':now' => gmdate('Y-m-d H:i:s'), ':err' => $error, ':id' => $station['id']]);
        return $error;
    }
    ingest_device($pdo, $station, $device);
    return null;
}

/** Compass direction of the day's summed wind vector, or null if the wind cancelled out. */
function prevailing_direction($x, $y): ?int {
    if ($x === null || $y === null || ((float)$x === 0.0 && (float)$y === 0.0)) {
        return null;
    }
    $degrees = rad2deg(atan2((float)$x, (float)$y));
    return (int)round(fmod($degrees + 360, 360));
}

/**
 * Recomputes the daily summary rows for yesterday and today in the station's
 * local time, and for the local day of $recorded_at (UTC) when that is another
 * day: a device that has been offline reports its last reading, which may be
 * days old, and that day's summary must take it in too.
 */
function update_daily_summaries(PDO $pdo, int $station_id, string $timezone, ?string $recorded_at = null): void {
    $zone = new DateTimeZone($timezone);
    $today = new DateTimeImmutable('today', $zone);
    $yesterday = $today->modify('-1 day');
    $days = [$yesterday->format('Y-m-d') => $yesterday, $today->format('Y-m-d') => $today];
    if ($recorded_at !== null) {
        $day = (new DateTimeImmutable($recorded_at, new DateTimeZone('UTC')))->setTimezone($zone)->setTime(0, 0);
        $days[$day->format('Y-m-d')] ??= $day;
    }
    summarize_days($pdo, $station_id, array_values($days));
}

/**
 * Regroups by local day in $timezone every summary the station's readings can
 * still support. Runs once, when the station's time zone first becomes known
 * and the summaries so far were grouped by UTC day.
 *
 * Summaries older than the raw readings are left as they are: with those
 * readings pruned there is nothing to rebuild them from, and a UTC-grouped day
 * is better than none. For the same reason the oldest day is left alone when
 * the retention prune has been cutting through it, as only part of it remains.
 */
function resummarize_all_days(PDO $pdo, int $station_id, string $timezone): void {
    $span = $pdo->prepare('SELECT MIN(recorded_at) AS first, MAX(recorded_at) AS last FROM readings WHERE station_id = :id');
    $span->execute([':id' => $station_id]);
    $row = $span->fetch();
    if (!$row || $row['first'] === null) {
        return;
    }
    $zone = new DateTimeZone($timezone);
    $utc = new DateTimeZone('UTC');
    $first = (new DateTimeImmutable($row['first'], $utc))->setTimezone($zone)->setTime(0, 0);
    $last = (new DateTimeImmutable($row['last'], $utc))->setTimezone($zone)->setTime(0, 0);

    // A UTC-grouped row can sit a day either side of the local span, so clear
    // one day beyond each end, except where the prune has already cut in.
    $pruned = strtotime($row['first'] . ' UTC') < time() - (RAW_RETENTION_DAYS - 1) * 86400;
    $start = $pruned ? $first->modify('+1 day') : $first->modify('-1 day');
    $end = $last->modify('+1 day');

    $days = [];
    for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
        $days[] = $day;
    }
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM daily_summaries WHERE station_id = :id AND date BETWEEN :start AND :end')
            ->execute([':id' => $station_id, ':start' => $start->format('Y-m-d'), ':end' => $end->format('Y-m-d')]);
        summarize_days($pdo, $station_id, $days);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/** Recomputes the daily summary row for each given local day. */
function summarize_days(PDO $pdo, int $station_id, array $days): void {
    $utc = new DateTimeZone('UTC');

    // wind_dir_avg is a speed-weighted vector average, so opposing winds cancel
    // instead of averaging to a direction that never blew.
    $select = $pdo->prepare('SELECT COUNT(*) AS reading_count,
            MIN(tempf) AS temp_min, MAX(tempf) AS temp_max, AVG(tempf) AS temp_avg,
            AVG(dew_point) AS dew_point_avg, MAX(dew_point) AS dew_point_max, MIN(dew_point) AS dew_point_min,
            AVG(humidity) AS humidity_avg, MIN(humidity) AS humidity_min, MAX(humidity) AS humidity_max,
            AVG(barom_rel) AS barom_avg, MIN(barom_rel) AS barom_min, MAX(barom_rel) AS barom_max,
            AVG(wind_speed) AS wind_avg, MAX(wind_gust) AS wind_max,
            MAX(feels_like) AS feels_like_max, MIN(feels_like) AS feels_like_min,
            MAX(daily_rain) AS rain_total, MAX(hourly_rain) AS rain_rate_max,
            MAX(solar_radiation) AS solar_max, MAX(uv) AS uv_max,
            SUM(wind_speed * sin(radians(wind_dir))) AS wind_x,
            SUM(wind_speed * cos(radians(wind_dir))) AS wind_y
        FROM readings WHERE station_id = :id AND recorded_at >= :start AND recorded_at < :end');

    $columns = ['temp_min', 'temp_max', 'temp_avg', 'dew_point_avg', 'dew_point_max', 'dew_point_min',
        'humidity_avg', 'humidity_min', 'humidity_max', 'barom_avg', 'barom_min', 'barom_max',
        'wind_avg', 'wind_max', 'wind_dir_avg', 'feels_like_max', 'feels_like_min',
        'rain_total', 'rain_rate_max', 'solar_max', 'uv_max', 'reading_count'];
    $upsert = $pdo->prepare('INSERT OR REPLACE INTO daily_summaries (station_id, date, ' . implode(', ', $columns) . ')
        VALUES (:id, :date, :' . implode(', :', $columns) . ')');

    foreach ($days as $day) {
        $select->execute([
            ':id' => $station_id,
            ':start' => $day->setTimezone($utc)->format('Y-m-d H:i:s'),
            ':end' => $day->modify('+1 day')->setTimezone($utc)->format('Y-m-d H:i:s'),
        ]);
        $row = $select->fetch();
        if (!$row || (int)$row['reading_count'] === 0) {
            continue;
        }
        $row['wind_dir_avg'] = prevailing_direction($row['wind_x'], $row['wind_y']);
        unset($row['wind_x'], $row['wind_y']);

        $params = [':id' => $station_id, ':date' => $day->format('Y-m-d')];
        foreach ($columns as $column) {
            $params[":$column"] = $row[$column] ?? null;
        }
        $upsert->execute($params);
    }
}
