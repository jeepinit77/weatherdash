<?php
/**
 * US National Weather Service (api.weather.gov) as a forecast source.
 *
 * NWS is free and needs no key, but it only covers the United States and its
 * territories, and it speaks a different dialect from Open-Meteo: forecasts
 * arrive as fourteen twelve-hour day/night periods rather than daily columns.
 * The functions here fetch those periods and reshape them into the same
 * columnar JSON Open-Meteo returns, so the API and the frontend only ever
 * have to deal with one forecast format.
 *
 * The UV index has no NWS equivalent and stays null: NWS does not publish one.
 * Gusts are reported only when the forecaster writes one into the wind phrase.
 * Sunrise and sunset are computed locally from the coordinates instead.
 * How much rain is expected is missing from the periods feed altogether, so it
 * is read out of the raw grid data the periods are written from. Those amounts
 * stop about three days out; public_html/api/forecast.php fills the rest of the
 * week from Open-Meteo.
 *
 * NWS also publishes active watches, warnings and advisories, which Open-Meteo
 * has no equivalent for. Those are fetched separately by public_html/api/alerts.php,
 * since they are issued and cancelled far faster than a forecast changes.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cache.php';

const NWS_API = 'https://api.weather.gov';

/** A grid square covers a fixed place, so the lookup that finds it can be cached for a long time. */
const NWS_POINT_CACHE_LIFETIME = 30 * 24 * 3600;

/**
 * "Not covered" is remembered for much less. It is almost always true for good,
 * but a wrong answer here switches a station's NWS forecast and alerts off, so
 * it should not be able to stick for a month.
 */
const NWS_POINT_MISS_LIFETIME = 86400;

/** The message every "NWS does not serve this place" error carries; see nws_is_out_of_coverage(). */
const NWS_OUT_OF_COVERAGE = 'This location is outside National Weather Service coverage';

/**
 * NWS icon URLs carry a short condition token (".../land/day/tsra,90?size=medium").
 * That token set is small and stable, which makes it a far more reliable source
 * than the free-text summary for picking one of our WMO-coded icons.
 */
const NWS_ICON_TO_WMO = [
    'skc' => 0,    'wind_skc' => 0,      'hot' => 0,             'cold' => 0,
    'few' => 1,    'wind_few' => 1,
    'sct' => 2,    'wind_sct' => 2,
    'bkn' => 3,    'wind_bkn' => 3,      'ovc' => 3,             'wind_ovc' => 3,
    'fog' => 45,   'haze' => 45,         'smoke' => 45,          'dust' => 45,
    'fzra' => 66,  'rain_fzra' => 66,    'snow_fzra' => 67,
    'rain' => 63,  'rain_showers' => 80, 'rain_showers_hi' => 80,
    'snow' => 73,  'blizzard' => 75,     'rain_snow' => 71,
    'sleet' => 77, 'rain_sleet' => 77,   'snow_sleet' => 77,
    'tsra' => 95,  'tsra_sct' => 95,     'tsra_hi' => 95,
    'tornado' => 95, 'hurricane' => 95,  'tropical_storm' => 95,
];

/** Alert severities the API reports, most serious first. Anything else sorts last. */
const NWS_SEVERITY_ORDER = ['Extreme', 'Severe', 'Moderate', 'Minor'];

/** Breaks ties between alerts of equal severity, most urgent first. */
const NWS_URGENCY_ORDER = ['Immediate', 'Expected', 'Future', 'Past'];

const NWS_COMPASS = [
    'N' => 0.0,    'NNE' => 22.5,  'NE' => 45.0,   'ENE' => 67.5,
    'E' => 90.0,   'ESE' => 112.5, 'SE' => 135.0,  'SSE' => 157.5,
    'S' => 180.0,  'SSW' => 202.5, 'SW' => 225.0,  'WSW' => 247.5,
    'W' => 270.0,  'WNW' => 292.5, 'NW' => 315.0,  'NNW' => 337.5,
];


/**
 * Whether a 404 from api.weather.gov is its considered answer that a point lies
 * outside its coverage, rather than a missing grid, a hiccup or an outage.
 * That answer is a problem document with type ".../problems/InvalidPoint"
 * (title "Data Unavailable For Requested Point"); any other 404 is not it.
 */
function nws_is_invalid_point_body($body): bool {
    $problem = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($problem)) {
        return false;
    }
    $type = (string)($problem['type'] ?? '');
    $title = (string)($problem['title'] ?? '');
    return str_ends_with($type, '/InvalidPoint') || stripos($title, 'Unavailable For Requested Point') !== false;
}

/** GETs a JSON document from api.weather.gov. Returns [data, error]. */
function nws_get(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_USERAGENT => contact_user_agent(),
        CURLOPT_HTTPHEADER => ['Accept: application/geo+json'],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 404 && nws_is_invalid_point_body($body)) {
        return [null, NWS_OUT_OF_COVERAGE];
    }
    if ($code !== 200 || !$body) {
        return [null, "The National Weather Service did not respond (HTTP $code)"];
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        return [null, 'The National Weather Service returned an unreadable response'];
    }
    return [$data, null];
}

/**
 * Whether an error from the calls below means the NWS simply does not serve
 * this location, as opposed to being unable to answer right now. The first is
 * a settled fact worth remembering; the second is worth retrying.
 */
function nws_is_out_of_coverage(?string $error): bool {
    return $error === NWS_OUT_OF_COVERAGE;
}

/**
 * Resolves coordinates to the forecast office grid square that covers them.
 * Returns [['office', 'x', 'y', 'timezone'], error].
 *
 * A found grid square is cached for a month and "not covered" for a day, under
 * separate keys so each keeps its own lifetime. Any other failure is not cached
 * at all: it says nothing about the place, only about the moment.
 */
function nws_resolve_point(float $lat, float $lon): array {
    $hash = md5("$lat,$lon");
    $hit_key = 'nws_point_' . $hash;
    $miss_key = 'nws_point_miss_' . $hash;

    $cached = json_decode((string)cache_get($hit_key, NWS_POINT_CACHE_LIFETIME), true);
    // Files from before misses had a key of their own hold {"error": ...}; ignore those.
    if (is_array($cached) && isset($cached['office'], $cached['x'], $cached['y'])) {
        return [$cached, null];
    }
    if (cache_get($miss_key, NWS_POINT_MISS_LIFETIME) !== null) {
        return [null, NWS_OUT_OF_COVERAGE];
    }

    [$data, $error] = nws_get(NWS_API . "/points/$lat,$lon");
    if ($error !== null) {
        // Remember "not covered" so an out-of-area station stops asking every time.
        if (nws_is_out_of_coverage($error)) {
            cache_put($miss_key, json_encode(['error' => $error]));
        }
        return [null, $error];
    }

    $p = $data['properties'] ?? [];
    if (empty($p['gridId']) || !isset($p['gridX'], $p['gridY'])) {
        // A point NWS knows but forecasts for no grid, such as open water.
        cache_put($miss_key, json_encode(['error' => NWS_OUT_OF_COVERAGE]));
        return [null, NWS_OUT_OF_COVERAGE];
    }
    $point = [
        'office' => (string)$p['gridId'],
        'x' => (int)$p['gridX'],
        'y' => (int)$p['gridY'],
        'timezone' => (string)($p['timeZone'] ?? 'UTC'),
    ];
    cache_put($hit_key, json_encode($point));
    return [$point, null];
}

/** Pulls the condition token out of an NWS icon URL, e.g. ".../day/tsra,90/bkn?size=medium" -> "tsra". */
function nws_icon_token(?string $icon): ?string {
    if ($icon === null || $icon === '') {
        return null;
    }
    $path = (string)(parse_url($icon, PHP_URL_PATH) ?? '');
    foreach (array_values(array_filter(explode('/', $path))) as $segment) {
        $token = explode(',', $segment)[0];
        if (isset(NWS_ICON_TO_WMO[$token])) {
            return $token;
        }
    }
    return null;
}

function nws_weather_code(?string $icon): ?int {
    $token = nws_icon_token($icon);
    return $token === null ? null : NWS_ICON_TO_WMO[$token];
}

/** Highest number in a phrase, or null if it holds none. */
function nws_max_number(string $phrase): ?float {
    if (!preg_match_all('/[0-9]+(?:\.[0-9]+)?/', $phrase, $matches)) {
        return null;
    }
    return max(array_map('floatval', $matches[0]));
}

/**
 * NWS reports wind as a human phrase: "13 mph", "9 to 13 mph", "around 10 mph",
 * and occasionally "5 to 10 mph, with gusts as high as 25 mph". We take the top
 * of the sustained range, to match Open-Meteo's wind_speed_10m_max; anything
 * after "gust" is a different measurement and must not be read as the wind.
 */
function nws_wind_speed(?string $phrase): ?float {
    if ($phrase === null) {
        return null;
    }
    return nws_max_number(preg_split('/\bgust/i', $phrase)[0]);
}

/** The gust out of a wind phrase that mentions one, e.g. "with gusts as high as 25 mph". */
function nws_wind_gust(?string $phrase): ?float {
    if ($phrase === null) {
        return null;
    }
    $parts = preg_split('/\bgust/i', $phrase, 2);
    return count($parts) === 2 ? nws_max_number($parts[1]) : null;
}

function nws_wind_direction(?string $cardinal): ?float {
    $key = strtoupper(trim((string)$cardinal));
    return NWS_COMPASS[$key] ?? null;
}

function nws_pop(array $period): ?float {
    $value = $period['probabilityOfPrecipitation']['value'] ?? null;
    return $value === null ? null : (float)$value;
}

/**
 * Splits an ISO 8601 "start/duration" stamp, as the grid data times every
 * value, into [start, end] unix timestamps.
 */
function nws_parse_interval(string $valid_time): ?array {
    $parts = explode('/', $valid_time);
    if (count($parts) !== 2) {
        return null;
    }
    try {
        $start = new DateTimeImmutable($parts[0]);
        $end = $start->add(new DateInterval($parts[1]));
    } catch (Exception $e) {
        return null;
    }
    return [$start->getTimestamp(), $end->getTimestamp()];
}

/**
 * How much rain the forecast expects, from the raw grid document behind the
 * periods feed: [[start, end, inches], ...]. Nobody publishes this as a plain
 * daily total, so it arrives as a run of intervals, usually six hours each.
 *
 * An empty result means the amount is simply unknown, which is what a missing
 * grid document or a rainless forecast both look like here; the days that get
 * no value from it are reported as null rather than as zero.
 */
function nws_fetch_precip(string $grid_url): array {
    [$doc, $error] = nws_get($grid_url);
    if ($error !== null) {
        return [];
    }
    $qpf = $doc['properties']['quantitativePrecipitation'] ?? null;
    if (!is_array($qpf) || !is_array($qpf['values'] ?? null)) {
        return [];
    }
    // The grid data is metric whatever the periods feed was asked for.
    $to_inches = str_contains((string)($qpf['uom'] ?? ''), 'mm') ? 1 / 25.4 : 1.0;

    $intervals = [];
    foreach ($qpf['values'] as $entry) {
        if (!is_array($entry) || !isset($entry['value']) || !is_numeric($entry['value'])) {
            continue;
        }
        $span = nws_parse_interval((string)($entry['validTime'] ?? ''));
        if ($span !== null) {
            $intervals[] = [$span[0], $span[1], (float)$entry['value'] * $to_inches];
        }
    }
    return $intervals;
}

/**
 * The share of those intervals that falls inside one local day. A six-hour
 * block that straddles midnight is divided between the two days in proportion
 * to the time it spends in each, since the grid says nothing finer than that.
 *
 * The amounts only run about three days out, so the last day they touch is
 * usually covered for a few hours only. A day the intervals stop short of is
 * null rather than a total of just those hours, which would read as a dry day.
 */
function nws_precip_total(array $intervals, int $start, int $end): ?float {
    $total = 0.0;
    $covered = false;
    $reach = null;
    foreach ($intervals as [$from, $to, $inches]) {
        $reach = max($reach ?? $to, $to);
        $overlap = min($to, $end) - max($from, $start);
        if ($overlap <= 0) {
            continue;
        }
        $covered = true;
        $span = $to - $from;
        $total += $span > 0 ? $inches * ($overlap / $span) : $inches;
    }
    return $covered && $reach >= $end ? round($total, 2) : null;
}

/** Unix timestamp of local midnight for the day a period starts in. */
function nws_local_midnight(string $start_time, DateTimeZone $tz): ?int {
    if ($start_time === '') {
        return null;
    }
    try {
        $dt = new DateTimeImmutable($start_time);
    } catch (Exception $e) {
        return null;
    }
    return $dt->setTimezone($tz)->setTime(0, 0)->getTimestamp();
}

/**
 * Folds the twelve-hour day/night periods into one entry per local calendar day.
 * A period belongs to the day it starts in, so "Monday Night" counts as Monday.
 */
function nws_build_daily(array $periods, DateTimeZone $tz, float $lat, float $lon, array $precip): array {
    $days = [];
    foreach ($periods as $period) {
        if (!is_array($period)) {
            continue;
        }
        $midnight = nws_local_midnight((string)($period['startTime'] ?? ''), $tz);
        if ($midnight === null) {
            continue;
        }
        if (!isset($days[$midnight])) {
            $days[$midnight] = ['day' => null, 'nights' => []];
        }
        if (!empty($period['isDaytime'])) {
            // "This Afternoon" is a partial first day, but it is still the day's forecast.
            $days[$midnight]['day'] ??= $period;
        } else {
            $days[$midnight]['nights'][] = $period;
        }
    }
    ksort($days);

    $columns = [
        'time' => [], 'weather_code' => [], 'temperature_2m_max' => [], 'temperature_2m_min' => [],
        'precipitation_probability_max' => [], 'precipitation_sum' => [],
        'wind_speed_10m_max' => [], 'wind_gusts_10m_max' => [],
        'wind_direction_10m_dominant' => [], 'uv_index_max' => [], 'sunrise' => [], 'sunset' => [],
        'detail_text' => [],
    ];

    foreach ($days as $midnight => $parts) {
        $day = $parts['day'];
        $nights = $parts['nights'];
        // The daytime period is what people mean by "the forecast"; fall back to the night.
        $lead = $day ?? ($nights[0] ?? null);
        if ($lead === null) {
            continue;
        }
        $all = $day === null ? $nights : array_merge([$day], $nights);

        $night_temps = [];
        foreach ($nights as $night) {
            if (isset($night['temperature'])) {
                $night_temps[] = (float)$night['temperature'];
            }
        }
        $pops = [];
        $winds = [];
        $gusts = [];
        foreach ($all as $period) {
            $pop = nws_pop($period);
            if ($pop !== null) {
                $pops[] = $pop;
            }
            $wind = nws_wind_speed($period['windSpeed'] ?? null);
            if ($wind !== null) {
                $winds[] = $wind;
            }
            $gust = nws_wind_gust($period['windSpeed'] ?? null);
            if ($gust !== null) {
                $gusts[] = $gust;
            }
        }

        $detail = trim((string)($lead['detailedForecast'] ?? ''));
        if ($day !== null && $nights) {
            $night_detail = trim((string)($nights[0]['detailedForecast'] ?? ''));
            if ($night_detail !== '') {
                $detail = trim($detail . ' Tonight: ' . $night_detail);
            }
        }

        $sun = date_sun_info($midnight + 12 * 3600, $lat, $lon);

        $columns['time'][] = (int)$midnight;
        $columns['weather_code'][] = nws_weather_code($lead['icon'] ?? null);
        $columns['temperature_2m_max'][] = ($day !== null && isset($day['temperature'])) ? (float)$day['temperature'] : null;
        $columns['temperature_2m_min'][] = $night_temps ? min($night_temps) : null;
        $columns['precipitation_probability_max'][] = $pops ? max($pops) : null;
        $columns['precipitation_sum'][] = nws_precip_total($precip, (int)$midnight, (int)$midnight + 86400);
        $columns['wind_speed_10m_max'][] = $winds ? max($winds) : null;
        // Only present when the forecaster wrote a gust into the wind phrase.
        $columns['wind_gusts_10m_max'][] = $gusts ? max($gusts) : null;
        $columns['wind_direction_10m_dominant'][] = nws_wind_direction($lead['windDirection'] ?? null);
        $columns['uv_index_max'][] = null;
        $columns['sunrise'][] = is_int($sun['sunrise'] ?? null) ? $sun['sunrise'] : null;
        $columns['sunset'][] = is_int($sun['sunset'] ?? null) ? $sun['sunset'] : null;
        $columns['detail_text'][] = $detail !== '' ? $detail : null;
    }
    return $columns;
}

function nws_build_hourly(array $periods): array {
    $columns = [
        'time' => [], 'temperature_2m' => [], 'precipitation_probability' => [], 'weather_code' => [],
        'dew_point_2m' => [], 'relative_humidity_2m' => [], 'wind_speed_10m' => [], 'wind_direction_10m' => [],
    ];
    foreach ($periods as $period) {
        if (!is_array($period) || empty($period['startTime'])) {
            continue;
        }
        try {
            $time = (new DateTimeImmutable((string)$period['startTime']))->getTimestamp();
        } catch (Exception $e) {
            continue;
        }
        $columns['time'][] = $time;
        $columns['temperature_2m'][] = isset($period['temperature']) ? (float)$period['temperature'] : null;
        $columns['precipitation_probability'][] = nws_pop($period);
        $columns['weather_code'][] = nws_weather_code($period['icon'] ?? null);
        // The hourly feed gives dew point in Celsius even when asked for US units.
        $dew = $period['dewpoint']['value'] ?? null;
        $columns['dew_point_2m'][] = is_numeric($dew) ? round((float)$dew * 9 / 5 + 32, 1) : null;
        $humidity = $period['relativeHumidity']['value'] ?? null;
        $columns['relative_humidity_2m'][] = is_numeric($humidity) ? (float)$humidity : null;
        $columns['wind_speed_10m'][] = nws_wind_speed($period['windSpeed'] ?? null);
        $columns['wind_direction_10m'][] = nws_wind_direction($period['windDirection'] ?? null);
    }
    return $columns;
}

/**
 * Fetches an NWS forecast shaped like an Open-Meteo response.
 * Returns [json_string, error]; exactly one of the two is set.
 */
function nws_fetch_forecast(float $lat, float $lon): array {
    [$point, $error] = nws_resolve_point($lat, $lon);
    if ($error !== null) {
        return [null, $error];
    }
    $grid = NWS_API . "/gridpoints/{$point['office']}/{$point['x']},{$point['y']}";

    [$daily_doc, $error] = nws_get("$grid/forecast?units=us");
    if ($error !== null) {
        return [null, $error];
    }
    [$hourly_doc, $hourly_error] = nws_get("$grid/forecast/hourly?units=us");
    // The grid document is the one place NWS puts a rainfall amount; the forecast
    // is still worth showing without it, so a failure here just leaves it out.
    $precip = nws_fetch_precip($grid);

    $timezone = $point['timezone'];
    try {
        $tz = new DateTimeZone($timezone);
    } catch (Exception $e) {
        $tz = new DateTimeZone('UTC');
        $timezone = 'UTC';
    }

    $daily = nws_build_daily($daily_doc['properties']['periods'] ?? [], $tz, $lat, $lon, $precip);
    if (!$daily['time']) {
        return [null, 'The National Weather Service returned no forecast for this location'];
    }

    return [json_encode([
        'source' => 'nws',
        'timezone' => $timezone,
        'daily' => $daily,
        // An hourly outage is survivable: the daily forecast is still worth showing.
        'hourly' => $hourly_error !== null ? null : nws_build_hourly($hourly_doc['properties']['periods'] ?? []),
    ]), null];
}

/** Trims an alert field, treating whitespace-only text as absent rather than empty. */
function nws_alert_text($value): ?string {
    $text = trim((string)$value);
    return $text === '' ? null : $text;
}

function nws_severity_rank(?string $severity): int {
    $index = array_search((string)$severity, NWS_SEVERITY_ORDER, true);
    return $index === false ? count(NWS_SEVERITY_ORDER) : $index;
}

function nws_urgency_rank(?string $urgency): int {
    $index = array_search((string)$urgency, NWS_URGENCY_ORDER, true);
    return $index === false ? count(NWS_URGENCY_ORDER) : $index;
}

/**
 * Active watches, warnings and advisories covering a point, most serious first.
 * Returns [alerts, error]; an empty array means the NWS has nothing in effect
 * there, which is a real answer and quite different from a null one.
 */
function nws_fetch_alerts(float $lat, float $lon): array {
    [$data, $error] = nws_get(NWS_API . '/alerts/active?' . http_build_query(['point' => "$lat,$lon"]));
    if ($error !== null) {
        return [null, $error];
    }

    $alerts = [];
    foreach ($data['features'] ?? [] as $feature) {
        $p = $feature['properties'] ?? null;
        if (!is_array($p)) {
            continue;
        }
        // Offices also publish test and exercise messages on this feed. Only a
        // live alert belongs on a dashboard.
        if (($p['status'] ?? 'Actual') !== 'Actual') {
            continue;
        }
        $alerts[] = [
            'id' => (string)($feature['id'] ?? $p['id'] ?? ''),
            'event' => nws_alert_text($p['event'] ?? null),
            'severity' => nws_alert_text($p['severity'] ?? null),
            'urgency' => nws_alert_text($p['urgency'] ?? null),
            'certainty' => nws_alert_text($p['certainty'] ?? null),
            'headline' => nws_alert_text($p['headline'] ?? null),
            'description' => nws_alert_text($p['description'] ?? null),
            'instruction' => nws_alert_text($p['instruction'] ?? null),
            // onset is when the weather arrives; effective is when the office
            // issued the alert, which is the closest thing when onset is absent.
            'onset' => nws_alert_text($p['onset'] ?? $p['effective'] ?? null),
            'expires' => nws_alert_text($p['ends'] ?? $p['expires'] ?? null),
            'areaDesc' => nws_alert_text($p['areaDesc'] ?? null),
        ];
    }

    usort($alerts, fn(array $a, array $b): int =>
        [nws_severity_rank($a['severity']), nws_urgency_rank($a['urgency'])]
        <=> [nws_severity_rank($b['severity']), nws_urgency_rank($b['urgency'])]);

    return [$alerts, null];
}

/**
 * Drops alerts that have already run out, so a cached reply never reports one
 * as still in effect after its own expiry has passed.
 */
function nws_drop_expired(array $alerts, int $now): array {
    $live = array_filter($alerts, function ($alert) use ($now): bool {
        if (!is_array($alert)) {
            return false;
        }
        $expires = $alert['expires'] ?? null;
        if ($expires === null) {
            return true;
        }
        $at = strtotime((string)$expires);
        return $at === false || $at > $now;
    });
    return array_values($live);
}
