<?php
/**
 * GET ?slug=... -> record high/low temperature for today's calendar date at the station's
 * location, drawn from Open-Meteo's historical archive (ERA5 reanalysis, back to 1950),
 * and the normals for the date: the average high and low, and the average rain by this
 * point in the month and in the year, over the 1991-2020 standard period.
 *
 * The archive request is the expensive part: some 27,000 days of highs and lows.
 * Rather than repeat it every day for every date, it is fetched once a month per
 * location and folded into a table of the record for each calendar date, which
 * is what gets cached. Today's answer is then just a lookup in that table. The
 * newest weeks are missing from it until the next refresh, which matters little
 * next to seventy-odd years (and the archive itself runs days behind anyway).
 *
 * A failed or unreadable archive answer is never cached: the previous table is
 * served if there is one, and otherwise the request fails this time only.
 */

require_once __DIR__ . '/bootstrap.php';

const RECORDS_START_YEAR = 1950;
/** The current climate-normal period, as NOAA and the WMO use it. */
const NORMALS_FIRST_YEAR = 1991;
const NORMALS_LAST_YEAR = 2020;
/** A normal high or low averages this many days either side, so one odd year does not show as a jag. */
const NORMALS_SMOOTHING_DAYS = 7;
const RECORDS_TABLE_LIFETIME = 30 * 86400;
const RECORDS_TABLE_STALE_LIFETIME = 60 * 86400;

$pdo = get_db_connection();
$station = require_station_from_query($pdo);
$lat = round((float)$station['latitude'], 3);
$lon = round((float)$station['longitude'], 3);
$zone = station_timezone($station);

/**
 * Folds the archive's daily columns into the record for each calendar date:
 * {"MM-DD": {"high": [value, year], "low": [value, year], "normal": {...}}}.
 * The earliest year keeps a tie. Returns null for anything that is not a real
 * archive answer.
 */
function build_records_table(?array $data): ?array {
    $times = $data['daily']['time'] ?? null;
    if (!is_array($times) || !$times) {
        return null;
    }
    $highs = $data['daily']['temperature_2m_max'] ?? [];
    $lows = $data['daily']['temperature_2m_min'] ?? [];

    $table = [];
    foreach ($times as $i => $time) {
        $month_day = substr((string)$time, 5);
        $year = (int)substr((string)$time, 0, 4);
        $high = $highs[$i] ?? null;
        $low = $lows[$i] ?? null;
        if (is_numeric($high) && (!isset($table[$month_day]['high']) || $high > $table[$month_day]['high'][0])) {
            $table[$month_day]['high'] = [(float)$high, $year];
        }
        if (is_numeric($low) && (!isset($table[$month_day]['low']) || $low < $table[$month_day]['low'][0])) {
            $table[$month_day]['low'] = [(float)$low, $year];
        }
    }
    if (!$table) {
        return null;
    }
    foreach (build_normals($data['daily']) as $month_day => $normal) {
        if (isset($table[$month_day])) {
            $table[$month_day]['normal'] = $normal;
        }
    }
    return $table;
}

/**
 * The normals for each calendar date over the standard period: the average
 * high and low (each smoothed across neighbouring dates), and the average rain
 * that has fallen by the end of that date, counted from the first of its month
 * and from the first of the year.
 */
function build_normals(array $daily): array {
    $highs = [];
    $lows = [];
    $month_to_date = [];
    $year_to_date = [];
    $running_month = 0.0;
    $running_year = 0.0;
    $previous = null;
    foreach ($daily['time'] as $i => $time) {
        $year = (int)substr((string)$time, 0, 4);
        if ($year < NORMALS_FIRST_YEAR || $year > NORMALS_LAST_YEAR) {
            continue;
        }
        $month_day = substr((string)$time, 5);
        if ($previous === null || substr($previous, 0, 4) !== substr((string)$time, 0, 4)) {
            $running_year = 0.0;
        }
        if ($previous === null || substr($previous, 0, 7) !== substr((string)$time, 0, 7)) {
            $running_month = 0.0;
        }
        $previous = (string)$time;
        $rain = $daily['precipitation_sum'][$i] ?? null;
        if (is_numeric($rain)) {
            $running_month += (float)$rain;
            $running_year += (float)$rain;
        }
        $month_to_date[$month_day][] = $running_month;
        $year_to_date[$month_day][] = $running_year;
        $high = $daily['temperature_2m_max'][$i] ?? null;
        $low = $daily['temperature_2m_min'][$i] ?? null;
        if (is_numeric($high)) $highs[$month_day][] = (float)$high;
        if (is_numeric($low)) $lows[$month_day][] = (float)$low;
    }
    if (!$highs) {
        return [];
    }

    $mean = fn(array $values) => $values ? array_sum($values) / count($values) : null;
    $dates = array_keys($highs);
    sort($dates);
    $count = count($dates);
    $smoothed = function (array $by_date, int $at) use ($dates, $count): ?float {
        $values = [];
        for ($offset = -NORMALS_SMOOTHING_DAYS; $offset <= NORMALS_SMOOTHING_DAYS; $offset++) {
            // The calendar wraps, so late December borrows from early January.
            array_push($values, ...($by_date[$dates[($at + $offset + $count) % $count]] ?? []));
        }
        return $values ? array_sum($values) / count($values) : null;
    };

    $normals = [];
    foreach ($dates as $at => $month_day) {
        $normals[$month_day] = [
            'high' => round($smoothed($highs, $at), 1),
            'low' => round($smoothed($lows, $at), 1),
            'rainMonth' => round($mean($month_to_date[$month_day] ?? []) ?? 0, 2),
            'rainYear' => round($mean($year_to_date[$month_day] ?? []) ?? 0, 2),
        ];
    }
    return $normals;
}

function fetch_records_table(float $lat, float $lon, DateTimeZone $zone): ?string {
    $end_date = (new DateTimeImmutable('today', $zone))->modify('-1 day')->format('Y-m-d');
    $url = 'https://archive-api.open-meteo.com/v1/archive?' . http_build_query([
        'latitude' => $lat,
        'longitude' => $lon,
        'start_date' => RECORDS_START_YEAR . '-01-01',
        'end_date' => $end_date,
        'daily' => 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        'temperature_unit' => 'fahrenheit',
        'precipitation_unit' => 'inch',
        'timezone' => 'auto',
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => 'WeatherDash/1.0',
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$response) {
        return null;
    }
    $table = build_records_table(json_decode($response, true));
    return $table === null ? null : json_encode($table);
}

$json = cache_remember(
    'recordtable2_' . md5("$lat,$lon"),
    RECORDS_TABLE_LIFETIME,
    RECORDS_TABLE_STALE_LIFETIME,
    fn() => fetch_records_table($lat, $lon, $zone)
);
$table = $json === null ? null : json_decode($json, true);
if (!is_array($table)) {
    fail('Records are temporarily unavailable', 502);
}

$today = $table[(new DateTimeImmutable('now', $zone))->format('m-d')] ?? [];
$record = fn(?array $entry) => $entry === null ? null : ['value' => (int)round($entry[0]), 'year' => (int)$entry[1]];

send_json([
    'records' => [
        'recordHigh' => $record($today['high'] ?? null),
        'recordLow' => $record($today['low'] ?? null),
        'sinceYear' => RECORDS_START_YEAR,
        'normal' => isset($today['normal']) ? [
            'high' => $today['normal']['high'],
            'low' => $today['normal']['low'],
            'rainMonth' => $today['normal']['rainMonth'],
            'rainYear' => $today['normal']['rainYear'],
            'rainAnnual' => $table['12-31']['normal']['rainYear'] ?? null,
            'period' => NORMALS_FIRST_YEAR . '–' . NORMALS_LAST_YEAR,
        ] : null,
    ],
]);
