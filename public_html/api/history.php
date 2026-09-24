<?php
/**
 * GET ?slug=...&range=24h|7d|30d|1y -> { range, points }
 * 24h and 7d come from raw 5-minute readings (time is ISO UTC);
 * 30d and 1y come from daily summaries (time is the station's local date).
 *
 * The raw windows are measured back from now in UTC, which is what the stored
 * timestamps are. The daily windows start from the station's own local date,
 * since that is what the summaries are keyed by; the server's UTC date can be a
 * day off from it either way.
 */

require_once __DIR__ . '/bootstrap.php';

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$range = $_GET['range'] ?? '24h';

$raw_windows = ['24h' => '-24 hours', '7d' => '-7 days'];
$daily_windows = ['30d' => '-30 days', '1y' => '-1 year']; // applied to the station's local today

if (isset($raw_windows[$range])) {
    $stmt = $pdo->prepare("SELECT recorded_at, tempf, dew_point, humidity, barom_rel, wind_speed, wind_gust,
            daily_rain, solar_radiation, uv
        FROM readings
        WHERE station_id = :id AND recorded_at >= datetime('now', :window)
        ORDER BY recorded_at");
    $stmt->execute([':id' => $station['id'], ':window' => $raw_windows[$range]]);
    $points = array_map(fn($r) => [
        'time' => utc_to_iso($r['recorded_at']),
        'tempf' => num_or_null($r['tempf']),
        'tempMin' => null,
        'tempMax' => null,
        'dewPoint' => num_or_null($r['dew_point']),
        'humidity' => num_or_null($r['humidity']),
        'baromrelin' => num_or_null($r['barom_rel']),
        'windspeedmph' => num_or_null($r['wind_speed']),
        'windgustmph' => num_or_null($r['wind_gust']),
        'rainin' => num_or_null($r['daily_rain']),
        'solarradiation' => num_or_null($r['solar_radiation']),
        'uv' => num_or_null($r['uv']),
    ], $stmt->fetchAll());
} elseif (isset($daily_windows[$range])) {
    $stmt = $pdo->prepare("SELECT * FROM daily_summaries
        WHERE station_id = :id AND date >= :start
        ORDER BY date");
    $stmt->execute([':id' => $station['id'], ':start' => station_local_date($station, $daily_windows[$range])]);
    $points = array_map(fn($r) => [
        'time' => $r['date'],
        'tempf' => num_or_null($r['temp_avg']),
        'tempMin' => num_or_null($r['temp_min']),
        'tempMax' => num_or_null($r['temp_max']),
        'dewPoint' => num_or_null($r['dew_point_avg']),
        'humidity' => num_or_null($r['humidity_avg']),
        'baromrelin' => num_or_null($r['barom_avg']),
        'windspeedmph' => num_or_null($r['wind_avg']),
        'windgustmph' => num_or_null($r['wind_max']),
        'rainin' => num_or_null($r['rain_total']),
        'solarradiation' => num_or_null($r['solar_max']),
        'uv' => num_or_null($r['uv_max']),
        // Kept for good, since the 5-minute readings behind them are pruned after 90 days
        'readingCount' => $r['reading_count'] === null ? null : (int)$r['reading_count'],
        'windDirAvg' => $r['wind_dir_avg'] === null ? null : (int)$r['wind_dir_avg'],
        'feelsLikeMax' => num_or_null($r['feels_like_max']),
        'feelsLikeMin' => num_or_null($r['feels_like_min']),
        'humidityMin' => num_or_null($r['humidity_min']),
        'humidityMax' => num_or_null($r['humidity_max']),
        'dewPointMax' => num_or_null($r['dew_point_max']),
        'dewPointMin' => num_or_null($r['dew_point_min']),
        'baromMin' => num_or_null($r['barom_min']),
        'baromMax' => num_or_null($r['barom_max']),
        'rainRateMax' => num_or_null($r['rain_rate_max']),
    ], $stmt->fetchAll());
} else {
    fail('Unknown range');
}

send_json(['range' => $range, 'points' => $points]);
