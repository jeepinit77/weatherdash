<?php
/**
 * GET ?slug=... -> the station's forecast (unix timestamps), cached 30 minutes.
 *
 * Two services can answer. Open-Meteo works anywhere and carries the UV index;
 * the National Weather Service covers only the United States but writes the
 * forecast in words. Whichever answers, the response has the same shape, with
 * a "source" field naming the service that actually produced it.
 *
 * Where the National Weather Service answers, Open-Meteo still fills the
 * columns it leaves empty (the UV index, feels-like, gusts, rain amounts and
 * cloud cover by the hour) and never overrides one it filled. The daily rain
 * total is filled day by day, since NWS projects it only about three days out.
 * The response lists those in "supplemented", so the page can credit them properly.
 *
 * When the cached copy expires, one request refreshes it while any others
 * arriving meanwhile get the previous copy, so a popular station does not send
 * a burst of identical requests upstream every half hour. If every service is
 * down, the last forecast is served for up to a day rather than nothing.
 */

const FORECAST_CACHE_LIFETIME = 1800;
const FORECAST_STALE_LIFETIME = 86400;

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/nws.php';
require_once BACKEND_DIR . '/openmeteo.php';

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$lat = round((float)$station['latitude'], 3);
$lon = round((float)$station['longitude'], 3);
$provider = forecast_provider($station);

const OPEN_METEO_HOURLY = 'temperature_2m,precipitation_probability,weather_code,apparent_temperature,relative_humidity_2m,'
    . 'dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,uv_index,cloud_cover';

/** Open-Meteo's forecast, decoded, or null if it did not answer. */
function open_meteo_forecast(float $lat, float $lon): ?array {
    return open_meteo_get('https://api.open-meteo.com/v1/forecast', [
        'latitude' => $lat,
        'longitude' => $lon,
        'hourly' => OPEN_METEO_HOURLY,
        'daily' => 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset',
        'temperature_unit' => 'fahrenheit',
        'wind_speed_unit' => 'mph',
        'precipitation_unit' => 'inch',
        'timezone' => 'auto',
        'timeformat' => 'unixtime',
        'forecast_days' => 7,
    ]);
}

/** One column of an Open-Meteo-shaped block, keyed by its unix time. */
function column_by_time(array $block, string $column): array {
    $out = [];
    foreach (($block['time'] ?? []) as $i => $time) {
        $out[(int)$time] = $block[$column][$i] ?? null;
    }
    return $out;
}

/** True when a column is missing or holds nothing but nulls. */
function column_is_empty(array $block, string $column): bool {
    foreach (($block[$column] ?? []) as $value) {
        if ($value !== null) {
            return false;
        }
    }
    return true;
}

/**
 * The National Weather Service's rain amounts stop about three days out, so
 * each day after that takes Open-Meteo's amount instead. This is the one column
 * filled day by day rather than only when it is empty throughout, since the
 * week's rain is worth having even from a second source. Where each day's
 * figure came from goes in "precipitation_sum_source", so the page can say so.
 */
function supplement_rain_amounts(array $nws, array $om): array {
    $times = $nws['daily']['time'] ?? [];
    $amounts = $nws['daily']['precipitation_sum'] ?? [];
    $om_amounts = is_array($om['daily'] ?? null) ? column_by_time($om['daily'], 'precipitation_sum') : [];
    $sources = [];
    $filled = false;
    foreach ($times as $i => $time) {
        if (($amounts[$i] ?? null) !== null) {
            $sources[] = 'nws';
        } elseif (($om_amounts[(int)$time] ?? null) !== null) {
            $amounts[$i] = $om_amounts[(int)$time];
            $sources[] = 'open-meteo';
            $filled = true;
        } else {
            $amounts[$i] = null;
            $sources[] = null;
        }
    }
    $nws['daily']['precipitation_sum'] = $amounts;
    $nws['daily']['precipitation_sum_source'] = $sources;
    return [$nws, $filled ? ['daily.precipitation_sum'] : []];
}

/**
 * Fills the columns a National Weather Service forecast left empty from
 * Open-Meteo's, matched by time, and names the ones it filled.
 */
function supplement_forecast(array $nws, array $om): array {
    [$nws, $filled] = supplement_rain_amounts($nws, $om);
    foreach (['daily', 'hourly'] as $block) {
        if (!is_array($nws[$block] ?? null) || !is_array($om[$block] ?? null)) {
            continue;
        }
        foreach (array_keys($om[$block]) as $column) {
            if ($column === 'time' || !column_is_empty($nws[$block], $column)) {
                continue;
            }
            $by_time = column_by_time($om[$block], $column);
            $values = array_map(fn($t) => $by_time[(int)$t] ?? null, $nws[$block]['time'] ?? []);
            if (array_filter($values, fn($v) => $v !== null)) {
                $nws[$block][$column] = $values;
                $filled[] = "$block.$column";
            }
        }
    }
    $nws['supplemented'] = $filled;
    return $nws;
}

/**
 * Under 'auto' and 'nws' alike, a station out of NWS range or an outage at the
 * weather service falls back to Open-Meteo rather than leaving the tiles empty.
 * The response says which service answered, so nothing is passed off as NWS.
 */
function fetch_forecast(string $provider, float $lat, float $lon, string $slug): ?string {
    $om = open_meteo_forecast($lat, $lon);
    if ($provider === 'nws' || $provider === 'auto') {
        [$payload, $error] = nws_fetch_forecast($lat, $lon);
        if ($error !== null) {
            error_log("[weatherdash] NWS forecast for $slug: $error");
        } else {
            $nws = json_decode($payload, true);
            return json_encode($om !== null ? supplement_forecast($nws, $om) : $nws + ['supplemented' => []]);
        }
    }
    return $om !== null ? json_encode(['source' => 'open-meteo', 'supplemented' => []] + $om) : null;
}

$payload = cache_remember(
    'forecast3_' . $provider . '_' . md5("$lat,$lon"),
    FORECAST_CACHE_LIFETIME,
    FORECAST_STALE_LIFETIME,
    fn() => fetch_forecast($provider, $lat, $lon, $station['slug'])
);
if ($payload === null) {
    fail('Forecast is temporarily unavailable', 502);
}
send_json_text($payload);
