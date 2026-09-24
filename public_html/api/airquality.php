<?php
/**
 * GET ?slug=... -> air quality at the station: the US AQI now, overall and by
 * pollutant, and the hourly AQI for the next day. Cached 30 minutes.
 *
 * From Open-Meteo's air-quality API, which models it (CAMS) rather than
 * measuring it; nobody offers measured readings for every location without a
 * key, and the station itself has no air sensor.
 */

const AIR_CACHE_LIFETIME = 1800;
const AIR_STALE_LIFETIME = 86400;

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/cache.php';
require_once BACKEND_DIR . '/openmeteo.php';

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$lat = round((float)$station['latitude'], 3);
$lon = round((float)$station['longitude'], 3);

$payload = cache_remember(
    'airquality_' . md5("$lat,$lon"),
    AIR_CACHE_LIFETIME,
    AIR_STALE_LIFETIME,
    function () use ($lat, $lon): ?string {
        $data = open_meteo_get('https://air-quality-api.open-meteo.com/v1/air-quality', [
            'latitude' => $lat,
            'longitude' => $lon,
            'current' => 'us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,pm2_5,pm10,ozone,nitrogen_dioxide',
            'hourly' => 'us_aqi',
            'forecast_days' => 2,
            'timezone' => 'auto',
            'timeformat' => 'unixtime',
        ]);
        $now = $data['current'] ?? null;
        if (!is_array($now)) {
            return null;
        }
        $num = fn($v) => is_numeric($v) ? (float)$v : null;
        return json_encode([
            'time' => $num($now['time'] ?? null),
            'aqi' => $num($now['us_aqi'] ?? null),
            'pollutants' => [
                ['id' => 'pm2_5', 'aqi' => $num($now['us_aqi_pm2_5'] ?? null), 'concentration' => $num($now['pm2_5'] ?? null)],
                ['id' => 'pm10', 'aqi' => $num($now['us_aqi_pm10'] ?? null), 'concentration' => $num($now['pm10'] ?? null)],
                ['id' => 'ozone', 'aqi' => $num($now['us_aqi_ozone'] ?? null), 'concentration' => $num($now['ozone'] ?? null)],
                ['id' => 'no2', 'aqi' => $num($now['us_aqi_nitrogen_dioxide'] ?? null), 'concentration' => $num($now['nitrogen_dioxide'] ?? null)],
            ],
            'hourly' => [
                'time' => $data['hourly']['time'] ?? [],
                'aqi' => $data['hourly']['us_aqi'] ?? [],
            ],
        ]);
    }
);
if ($payload === null) {
    fail('Air quality is temporarily unavailable', 502);
}
send_json_text($payload);
