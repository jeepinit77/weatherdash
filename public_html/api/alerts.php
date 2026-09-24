<?php
/**
 * GET ?slug=... -> { supported: bool, alerts: [...] }
 *
 * Active National Weather Service watches, warnings and advisories for the
 * station's location, most serious first.
 *
 * `supported` is false wherever the NWS is not the station's forecaster: a
 * station its owner put on Open-Meteo, or one outside NWS coverage. The
 * dashboard then shows nothing at all, rather than an empty alerts panel on a
 * station that could never have any. `supported` with an empty list is the
 * other thing entirely: the NWS covers this place and has nothing in effect.
 *
 * Alerts get their own short cache instead of riding along with forecast.php's
 * half hour, because they are issued and cancelled far faster than a forecast
 * changes. What the cache holds is filtered against the clock on the way out,
 * so an alert that lapsed mid-cache is never reported as still in effect.
 * While one request refreshes an expired copy, others get the previous one.
 */

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/nws.php';

const ALERTS_CACHE_LIFETIME = 300;

/** How long a cached reply may still be served once the API stops answering. */
const ALERTS_STALE_GRACE = 3600;

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$lat = round((float)$station['latitude'], 3);
$lon = round((float)$station['longitude'], 3);

$unsupported = ['supported' => false, 'alerts' => []];

// Only a station the NWS forecasts gets NWS alerts. Note that forecast.php may
// still fall back to Open-Meteo for the forecast itself; that is about who
// answers on the day, not about who covers the location.
if (forecast_provider($station) === 'open-meteo') {
    send_json($unsupported);
}

$cache_key = 'alerts_' . md5("$lat,$lon");

// Reuses the forecast's cached grid lookup, so this costs nothing on the
// stations that already have one.
[$point, $error] = nws_resolve_point($lat, $lon);
if (nws_is_out_of_coverage($error)) {
    send_json($unsupported);
}

// When the weather service is unreachable, recent alerts still say something
// true about the weather; older ones are better left unsaid.
if ($point === null) {
    $json = cache_get($cache_key, ALERTS_STALE_GRACE);
} else {
    $json = cache_remember($cache_key, ALERTS_CACHE_LIFETIME, ALERTS_STALE_GRACE, function () use ($lat, $lon, $station) {
        [$fresh, $error] = nws_fetch_alerts($lat, $lon);
        if ($fresh === null) {
            error_log("[weatherdash] NWS alerts for {$station['slug']}: $error");
            return null;
        }
        return json_encode($fresh);
    });
}
$alerts = $json === null ? null : json_decode($json, true);
if (!is_array($alerts)) {
    fail('Alerts are temporarily unavailable', 502);
}

send_json(['supported' => true, 'alerts' => nws_drop_expired($alerts, time())]);
