<?php
/**
 * GET ?slug=... -> precipitation in 15-minute steps for the next four hours,
 * for the "rain starting soon" banner. Cached ten minutes.
 *
 * Only Open-Meteo publishes this (in the United States it comes from NOAA's
 * HRRR model, which runs every hour at 15-minute steps); the National Weather
 * Service has nothing finer than the hour. So this comes from Open-Meteo
 * whichever service the station's forecast uses.
 */

const NOWCAST_CACHE_LIFETIME = 600;
const NOWCAST_STALE_LIFETIME = 3600;

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/cache.php';
require_once BACKEND_DIR . '/openmeteo.php';

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$lat = round((float)$station['latitude'], 3);
$lon = round((float)$station['longitude'], 3);

$payload = cache_remember(
    'nowcast_' . md5("$lat,$lon"),
    NOWCAST_CACHE_LIFETIME,
    NOWCAST_STALE_LIFETIME,
    function () use ($lat, $lon): ?string {
        $data = open_meteo_get('https://api.open-meteo.com/v1/forecast', [
            'latitude' => $lat,
            'longitude' => $lon,
            'minutely_15' => 'precipitation,precipitation_probability',
            'forecast_minutely_15' => 16,
            'precipitation_unit' => 'inch',
            'timezone' => 'auto',
            'timeformat' => 'unixtime',
        ]);
        $steps = $data['minutely_15'] ?? null;
        if (!is_array($steps) || !is_array($steps['time'] ?? null)) {
            return null;
        }
        return json_encode([
            'time' => $steps['time'],
            'precipitation' => $steps['precipitation'] ?? [],
            'probability' => $steps['precipitation_probability'] ?? [],
        ]);
    }
);
if ($payload === null) {
    fail('Short-range precipitation is temporarily unavailable', 502);
}
send_json_text($payload);
