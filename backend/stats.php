<?php
/**
 * Derived figures the dashboard tiles show: today's and yesterday's extremes
 * (with the time they happened), recent rain totals and the pressure trend.
 */

/** Columns extreme() may rank by. It builds SQL from them, so nothing else gets in. */
const EXTREME_COLUMNS = ['tempf', 'wind_gust', 'humidity'];
const EXTREME_DIRECTIONS = ['ASC', 'DESC'];

/** The pressure trend compares against a reading this many seconds before the latest… */
const BAROM_TREND_SECONDS = 3 * 3600;
/** …or the nearest one within this much either side; failing that there is no trend. */
const BAROM_TREND_TOLERANCE = 1800;

/** A day's rain counts as a real rain, the kind a pasture notices, from this many inches. */
const MEANINGFUL_RAIN_INCHES = 0.10;
/** The least rain a gauge reports; a day with any less had none. */
const MEASURABLE_RAIN_INCHES = 0.01;

/** Start/end UTC bounds of a local calendar day, `$offset` days back from today. */
function local_day_bounds(string $timezone, int $offset): array {
    $zone = new DateTimeZone($timezone);
    $utc = new DateTimeZone('UTC');
    $day = (new DateTimeImmutable('today', $zone))->modify("$offset day");
    return [
        $day->setTimezone($utc)->format('Y-m-d H:i:s'),
        $day->modify('+1 day')->setTimezone($utc)->format('Y-m-d H:i:s'),
    ];
}

/** The highest or lowest reading of a column in a window, with when it occurred. */
function extreme(PDO $pdo, int $station_id, string $column, string $direction, string $start, string $end): array {
    if (!in_array($column, EXTREME_COLUMNS, true) || !in_array($direction, EXTREME_DIRECTIONS, true)) {
        throw new InvalidArgumentException("extreme() cannot rank by $column $direction");
    }
    $stmt = $pdo->prepare("SELECT $column AS value, recorded_at FROM readings
        WHERE station_id = :id AND recorded_at >= :start AND recorded_at < :end AND $column IS NOT NULL
        ORDER BY $column $direction, recorded_at LIMIT 1");
    $stmt->execute([':id' => $station_id, ':start' => $start, ':end' => $end]);
    $row = $stmt->fetch();
    return [
        'value' => $row ? (float)$row['value'] : null,
        'at' => $row ? utc_to_iso($row['recorded_at']) : null,
    ];
}

function day_stats(PDO $pdo, int $station_id, string $timezone, int $offset): array {
    [$start, $end] = local_day_bounds($timezone, $offset);
    return [
        'high' => extreme($pdo, $station_id, 'tempf', 'DESC', $start, $end),
        'low' => extreme($pdo, $station_id, 'tempf', 'ASC', $start, $end),
        'maxGust' => extreme($pdo, $station_id, 'wind_gust', 'DESC', $start, $end)['value'],
        'humidityHigh' => extreme($pdo, $station_id, 'humidity', 'DESC', $start, $end)['value'],
        'humidityLow' => extreme($pdo, $station_id, 'humidity', 'ASC', $start, $end)['value'],
    ];
}

/**
 * How far the relative pressure has moved over the last three hours, in inHg:
 * the latest reading minus the one nearest three hours before it. Null when no
 * reading lands within half an hour of that mark, since a trend measured over
 * some other span would not mean what a three-hour tendency means.
 */
function barom_trend_3h(PDO $pdo, int $station_id): ?float {
    $latest = $pdo->prepare('SELECT recorded_at, barom_rel FROM readings
        WHERE station_id = :id AND barom_rel IS NOT NULL ORDER BY recorded_at DESC LIMIT 1');
    $latest->execute([':id' => $station_id]);
    $now = $latest->fetch();
    if (!$now) {
        return null;
    }
    $at = strtotime($now['recorded_at'] . ' UTC');
    $target = $at - BAROM_TREND_SECONDS;

    $earlier = $pdo->prepare('SELECT barom_rel FROM readings
        WHERE station_id = :id AND barom_rel IS NOT NULL AND recorded_at BETWEEN :from AND :to
        ORDER BY ABS(julianday(recorded_at) - julianday(:target)), recorded_at LIMIT 1');
    $earlier->execute([
        ':id' => $station_id,
        ':from' => gmdate('Y-m-d H:i:s', $target - BAROM_TREND_TOLERANCE),
        ':to' => gmdate('Y-m-d H:i:s', $target + BAROM_TREND_TOLERANCE),
        ':target' => gmdate('Y-m-d H:i:s', $target),
    ]);
    $then = $earlier->fetchColumn();
    if ($then === false) {
        return null;
    }
    // Rounded past the station's own precision, so float noise never shows as a trend.
    return round((float)$now['barom_rel'] - (float)$then, 3);
}

/**
 * The station's own almanac figures, from its daily summaries: its last real
 * rain, this year's longest spell without one, and each day's high and low
 * this year, which the page counts against thresholds the viewer picks.
 *
 * Rain is counted by storm, not by calendar day: the run of wet days that ends
 * with the last real rain is added up, so a storm either side of midnight
 * shows as one rain. A day with no summary breaks a dry spell rather than
 * extending it, since nothing says whether it rained.
 */
function almanac_stats(PDO $pdo, array $station): array {
    $zone = station_timezone($station);
    $today = new DateTimeImmutable('today', $zone);
    $year_start = $today->format('Y') . '-01-01';

    // Last real rain may lie before this year, so look back a full year either way.
    $from = min($year_start, $today->modify('-365 days')->format('Y-m-d'));
    $rows = $pdo->prepare('SELECT date, rain_total, temp_max, temp_min FROM daily_summaries
        WHERE station_id = :id AND date >= :from ORDER BY date');
    $rows->execute([':id' => (int)$station['id'], ':from' => $from]);
    $days = [];
    foreach ($rows->fetchAll() as $row) {
        $days[$row['date']] = $row;
    }
    if (!$days) {
        return ['lastRain' => null, 'lightRainSince' => null, 'dryStretch' => null, 'yearTemps' => null];
    }
    $rain = fn(string $date) => isset($days[$date]) && $days[$date]['rain_total'] !== null ? (float)$days[$date]['rain_total'] : null;
    $day_after = fn(string $date) => (new DateTimeImmutable($date, $zone))->modify('+1 day')->format('Y-m-d');
    $day_before = fn(string $date) => (new DateTimeImmutable($date, $zone))->modify('-1 day')->format('Y-m-d');

    // The last real rain, with the rest of its storm added in.
    $last_rain = null;
    $light_since = 0.0;
    foreach (array_reverse(array_keys($days)) as $date) {
        $amount = $rain($date);
        if ($amount !== null && $amount >= MEANINGFUL_RAIN_INCHES) {
            $total = 0.0;
            for ($d = $date; ($r = $rain($d)) !== null && $r >= MEASURABLE_RAIN_INCHES; $d = $day_before($d)) {
                $total += $r;
            }
            for ($d = $day_after($date); ($r = $rain($d)) !== null && $r >= MEASURABLE_RAIN_INCHES; $d = $day_after($d)) {
                $total += $r;
                $light_since -= $r;
                $date = $d;
            }
            $last_rain = ['date' => $date, 'amount' => round($total, 2)];
            break;
        }
        if ($amount !== null) {
            $light_since += $amount;
        }
    }

    // This year's longest run of days without a real rain.
    $longest = null;
    $run_start = null;
    $run_length = 0;
    $expected = null;
    foreach ($days as $date => $row) {
        if ($date < $year_start) {
            continue;
        }
        $amount = $rain($date);
        $dry = $amount !== null && $amount < MEANINGFUL_RAIN_INCHES;
        if (!$dry || $date !== $expected) {
            $run_start = null;
            $run_length = 0;
        }
        if ($dry) {
            $run_start ??= $date;
            $run_length++;
            if ($longest === null || $run_length > $longest['days']) {
                $longest = ['days' => $run_length, 'start' => $run_start, 'end' => $date];
            }
        }
        $expected = $day_after($date);
    }
    if ($longest !== null) {
        $longest['ongoing'] = $longest['end'] === $today->format('Y-m-d');
    }

    // This year's highs and lows, a day apiece, rounded as the station reads them.
    $highs = [];
    $lows = [];
    $since = null;
    foreach ($days as $date => $row) {
        if ($date < $year_start) {
            continue;
        }
        $since ??= $date;
        if ($row['temp_max'] !== null) $highs[] = round((float)$row['temp_max'], 1);
        if ($row['temp_min'] !== null) $lows[] = round((float)$row['temp_min'], 1);
    }

    return [
        'lastRain' => $last_rain,
        'lightRainSince' => $last_rain !== null && $light_since >= MEASURABLE_RAIN_INCHES ? round($light_since, 2) : null,
        'dryStretch' => $longest,
        'yearTemps' => $since === null ? null : ['since' => $since, 'highs' => $highs, 'lows' => $lows],
    ];
}

function station_stats(PDO $pdo, array $station): array {
    $id = (int)$station['id'];
    $timezone = station_timezone($station)->getName();

    // The poller records every 5 minutes, so this averages roughly the last three readings.
    $wind = $pdo->prepare("SELECT AVG(wind_speed) FROM readings
        WHERE station_id = :id AND wind_speed IS NOT NULL AND recorded_at >= datetime('now', '-15 minutes')");
    $wind->execute([':id' => $id]);
    $wind_avg = $wind->fetchColumn();

    // Summaries are keyed by the station's local date, so "the last seven days"
    // has to start from the station's today, not the server's UTC one.
    $rain = $pdo->prepare('SELECT SUM(rain_total) FROM daily_summaries
        WHERE station_id = :id AND date >= :start');
    $rain->execute([':id' => $id, ':start' => station_local_date($station, '-6 days')]);
    $rain_7d = $rain->fetchColumn();

    return [
        'today' => day_stats($pdo, $id, $timezone, 0),
        'yesterday' => day_stats($pdo, $id, $timezone, -1),
        'windAvg15' => $wind_avg === null ? null : (float)$wind_avg,
        'rain7d' => $rain_7d === null ? null : (float)$rain_7d,
        'baromTrend3h' => barom_trend_3h($pdo, $id),
        'almanac' => almanac_stats($pdo, $station),
    ];
}
