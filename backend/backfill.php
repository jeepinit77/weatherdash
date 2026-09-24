<?php
/**
 * Pulls a station's past readings from Ambient, walking backwards a day at a time.
 *
 * Ambient's device endpoint returns up to 288 records (5-minute data, about a day)
 * ending at `endDate`, so older history means paging back one request per day.
 * The cron job calls backfill_step() a few days at a time to stay within the
 * one-request-per-second rate limit.
 *
 * The same endpoint also patches recent holes: gap_fill_step() refetches the
 * spans an outage kept the poller from recording.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ambient.php';

const BACKFILL_DAYS = 365;
/** Days fetched per cron run: each is one request, paced a second apart. */
const BACKFILL_DAYS_PER_RUN = 20;

/** Ambient throttles harder than its documented one request per second, so pace requests. */
const BACKFILL_REQUEST_GAP_US = 1_500_000;

/** Readings arrive every 5 minutes; a longer silence than this is a hole worth refilling. */
const GAP_THRESHOLD_SECONDS = 20 * 60;
/** History requests gap_fill_step() may make per station per cron run. */
const GAP_FILL_PAGES_PER_RUN = 3;
/** How far back gap_fill_step() looks for holes. */
const GAP_FILL_LOOKBACK_DAYS = 7;

/** @return array{0: ?array, 1: ?string} [records, error] */
function ambient_fetch_history(string $api_key, string $app_key, string $mac, int $end_ms, bool $retry = true): array {
    $url = 'https://rt.ambientweather.net/v1/devices/' . rawurlencode($mac) . '?' . http_build_query([
        'apiKey' => $api_key,
        'applicationKey' => $app_key,
        'endDate' => $end_ms,
        'limit' => 288,
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_USERAGENT => 'WeatherDash/1.0',
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false) {
        return [null, 'Could not reach Ambient Weather'];
    }
    if ($code === 429) {
        if ($retry) {
            sleep(5);
            return ambient_fetch_history($api_key, $app_key, $mac, $end_ms, false);
        }
        return [null, 'Ambient Weather rate limit reached'];
    }
    if ($code !== 200) {
        return [null, "Ambient Weather returned HTTP $code"];
    }
    $records = json_decode($resp, true);
    return is_array($records) ? [$records, null] : [null, 'Unexpected response from Ambient Weather'];
}

/** The station's MAC, looked up and saved on first use when the owner didn't supply one. */
function resolve_mac(PDO $pdo, array $station): ?string {
    $mac = trim((string)$station['mac_address']);
    if ($mac !== '') {
        return $mac;
    }
    [$devices, $error] = ambient_fetch_devices($station['api_key'], $station['application_key']);
    if ($error) {
        return null;
    }
    [$device, $error] = ambient_pick_device($devices, '');
    if ($error || empty($device['macAddress'])) {
        return null;
    }
    $pdo->prepare('UPDATE stations SET mac_address = :mac WHERE id = :id')
        ->execute([':mac' => $device['macAddress'], ':id' => $station['id']]);
    return $device['macAddress'];
}

function mark_backfill_complete(PDO $pdo, int $station_id): void {
    $pdo->prepare('UPDATE stations SET backfill_complete = 1 WHERE id = :id')->execute([':id' => $station_id]);
}

/**
 * The station's time zone as stored right now. Read fresh rather than from the
 * row a run started with, because a poll may set it part way through, and the
 * days summarized after that must be grouped the same way as everything else.
 */
function current_station_timezone(PDO $pdo, int $station_id): string {
    $stmt = $pdo->prepare('SELECT timezone FROM stations WHERE id = :id');
    $stmt->execute([':id' => $station_id]);
    return valid_timezone($stmt->fetchColumn() ?: null) ?? 'UTC';
}

/**
 * Stores one page of Ambient history in a single transaction.
 * Returns [records stored, oldest stored unix time or null, UTC dates touched].
 */
function store_history_page(PDO $pdo, int $station_id, array $records): array {
    $stored = 0;
    $oldest = null;
    $dates = [];
    $pdo->beginTransaction();
    try {
        foreach ($records as $record) {
            $recorded_at = is_array($record) ? store_reading($pdo, $station_id, $record) : null;
            if ($recorded_at === null) {
                continue;
            }
            $stored++;
            $time = strtotime($recorded_at . ' UTC');
            $oldest = $oldest === null ? $time : min($oldest, $time);
            $dates[substr($recorded_at, 0, 10)] = true;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return [$stored, $oldest, array_keys($dates)];
}

/**
 * Fetches up to BACKFILL_DAYS_PER_RUN older days for one station.
 * Returns a short status line for the cron log.
 *
 * Each page's days are summarized as soon as the page is stored, so a run that
 * dies part way leaves no stored-but-unsummarized days behind. The station is
 * only marked complete after its last page is summarized: the retention prune
 * waits for that flag, and must never cut into a day before its summary exists.
 */
function backfill_step(PDO $pdo, array $station): string {
    if ((int)$station['backfill_complete'] === 1) {
        return 'history complete';
    }
    $id = (int)$station['id'];
    $mac = resolve_mac($pdo, $station);
    if ($mac === null) {
        return 'history: could not determine the station MAC address';
    }

    $oldest_wanted = time() - BACKFILL_DAYS * 86400;
    $cursor = $station['backfill_cursor'] !== null ? strtotime($station['backfill_cursor'] . ' UTC') : time();
    $stored = 0;
    $status = null;
    $complete = false;

    for ($i = 0; $i < BACKFILL_DAYS_PER_RUN && $status === null; $i++) {
        if ($cursor <= $oldest_wanted) {
            $complete = true;
            $status = "history complete ($stored records this run)";
            break;
        }
        usleep(BACKFILL_REQUEST_GAP_US);

        [$records, $error] = ambient_fetch_history($station['api_key'], $station['application_key'], $mac, $cursor * 1000);
        if ($error) {
            $status = "history paused: $error";
            break;
        }
        if (!$records) {
            $complete = true;
            $status = "history complete, no older records ($stored this run)";
            break;
        }

        [$count, $oldest, $dates] = store_history_page($pdo, $id, $records);
        $stored += $count;
        summarize_backfilled_days($pdo, $id, current_station_timezone($pdo, $id), $dates);

        // Step past the oldest record so the next page continues from there. A
        // page with nothing usable in it (no timestamps, or nothing older than
        // the cursor) gives no such record, so step back a whole day instead:
        // one second at a time, the walk would never get through it.
        $cursor = ($oldest !== null && $oldest <= $cursor) ? $oldest - 1 : $cursor - 86400;
        $pdo->prepare('UPDATE stations SET backfill_cursor = :cursor WHERE id = :id')
            ->execute([':cursor' => gmdate('Y-m-d H:i:s', $cursor), ':id' => $id]);
    }

    if ($complete) {
        mark_backfill_complete($pdo, $id);
    }
    return $status ?? "history: $stored records back to " . gmdate('Y-m-d', $cursor);
}

/**
 * Rebuilds daily summaries for the days a page of history touched, plus the
 * day either side. $dates are UTC dates, and a local day can straddle two.
 */
function summarize_backfilled_days(PDO $pdo, int $station_id, string $timezone, array $dates): void {
    if (!$dates) {
        return;
    }
    $zone = new DateTimeZone($timezone);
    sort($dates);
    $start = (new DateTimeImmutable($dates[0], $zone))->modify('-1 day');
    $end = (new DateTimeImmutable(end($dates), $zone))->modify('+1 day');

    $days = [];
    for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
        $days[] = $day;
    }
    summarize_days($pdo, $station_id, $days);
}

/**
 * The first hole in a station's readings at or after $from: two consecutive
 * readings more than GAP_THRESHOLD_SECONDS apart. Returns [before, after] as
 * UTC strings (the readings either side of the hole), or null if there is none.
 */
function find_reading_gap(PDO $pdo, int $station_id, string $from): ?array {
    // The threshold is written into the SQL rather than bound: execute() binds
    // every value as text, and SQLite ranks any number below any text, so the
    // comparison would never be true.
    $stmt = $pdo->prepare('SELECT recorded_at, next_at FROM (
            SELECT recorded_at, LEAD(recorded_at) OVER (ORDER BY recorded_at) AS next_at
            FROM readings WHERE station_id = :id AND recorded_at >= :from
        )
        WHERE next_at IS NOT NULL
          AND (julianday(next_at) - julianday(recorded_at)) * 86400 > ' . (int)GAP_THRESHOLD_SECONDS . '
        ORDER BY recorded_at LIMIT 1');
    $stmt->execute([':id' => $station_id, ':from' => $from]);
    $row = $stmt->fetch();
    return $row ? [$row['recorded_at'], $row['next_at']] : null;
}

function set_gap_checked_to(PDO $pdo, int $station_id, string $utc): void {
    $pdo->prepare('UPDATE stations SET gap_checked_to = :at WHERE id = :id')
        ->execute([':at' => $utc, ':id' => $station_id]);
}

/**
 * Fills the holes an outage leaves in a station's readings. When polling stops
 * (Ambient down, cron not running, the host asleep) the station keeps recording,
 * and Ambient keeps that history; this fetches it once polling works again.
 *
 * Works through holes after the station's gap_checked_to mark, newest page of
 * each hole first, at most GAP_FILL_PAGES_PER_RUN requests per run; a hole too
 * big for one run is picked up again by the next, since what is left of it is
 * still a hole. A page that brings nothing new into a hole means Ambient has no
 * more for that span (the station itself was offline), so the mark moves past
 * it and it is never asked about again. Holes older than GAP_FILL_LOOKBACK_DAYS
 * are left alone: that far back belongs to the backfill, and close to the
 * retention prune a refetched day could be summarized from half its readings.
 *
 * Returns a short status line for the cron log.
 */
function gap_fill_step(PDO $pdo, array $station): string {
    $id = (int)$station['id'];
    $floor = time() - GAP_FILL_LOOKBACK_DAYS * 86400;
    $from = $station['gap_checked_to'];
    if ($from === null || strtotime($from . ' UTC') < $floor) {
        // Never checked, or not for a long while: start from the last reading
        // before the lookback window, so a hole that began before it is found too.
        $before = $pdo->prepare('SELECT MAX(recorded_at) FROM readings WHERE station_id = :id AND recorded_at < :floor');
        $before->execute([':id' => $id, ':floor' => gmdate('Y-m-d H:i:s', $floor)]);
        $from = $before->fetchColumn() ?: gmdate('Y-m-d H:i:s', $floor);
    }

    $mac = null;
    $pages = 0;
    $filled = 0;
    $status = null;
    while ($status === null) {
        $gap = find_reading_gap($pdo, $id, $from);
        if ($gap === null) {
            $latest = $pdo->prepare('SELECT MAX(recorded_at) FROM readings WHERE station_id = :id');
            $latest->execute([':id' => $id]);
            $last = $latest->fetchColumn();
            if ($last && $last > $from) {
                set_gap_checked_to($pdo, $id, $last);
            }
            $status = $filled > 0 ? "gaps: filled $filled records" : 'gaps: none';
            break;
        }
        if ($pages >= GAP_FILL_PAGES_PER_RUN) {
            $status = "gaps: filled $filled records, more next run";
            break;
        }
        $mac ??= resolve_mac($pdo, $station);
        if ($mac === null) {
            $status = 'gaps: could not determine the station MAC address';
            break;
        }

        [$before, $after] = $gap;
        $hole_start = max(strtotime($before . ' UTC'), $floor);
        $hole_end = strtotime($after . ' UTC');

        usleep(BACKFILL_REQUEST_GAP_US);
        $pages++;
        [$records, $error] = ambient_fetch_history(
            $station['api_key'], $station['application_key'], $mac, ($hole_end - 1) * 1000);
        if ($error) {
            $status = "gaps paused: $error";
            break;
        }

        [$count, $oldest, $dates] = $records ? store_history_page($pdo, $id, $records) : [0, null, []];
        $filled += $count;
        summarize_backfilled_days($pdo, $id, current_station_timezone($pdo, $id), $dates);

        // Ambient answers with the newest records up to the end of the hole. If
        // they reach back to its start, the page covered all Ambient has for
        // it; otherwise what remains is a smaller hole for the next page. A page
        // with nothing inside the hole at all would only be fetched again and
        // again, so that hole is settled too.
        if ($oldest === null || $oldest <= $hole_start || $oldest >= $hole_end) {
            set_gap_checked_to($pdo, $id, $after);
            $from = $after;
        }
    }
    return $status;
}

/**
 * One backfill at a time. The cron job and the runner started when a station is
 * added would otherwise walk the same pages and fight over the SQLite write lock.
 * Returns the open handle, which the caller must keep in scope for as long as it
 * wants the lock, or null when someone else already holds it.
 *
 * @return resource|null
 */
function backfill_try_lock() {
    $handle = @fopen(__DIR__ . '/backfill.lock', 'c');
    if (!$handle) {
        return null;
    }
    if (!flock($handle, LOCK_EX | LOCK_NB)) {
        fclose($handle);
        return null;
    }
    return $handle;
}

/**
 * Starts filling in a station's history now rather than at the next cron tick,
 * so a station added just after one has just run isn't blank for five minutes.
 * Detached: the shell backgrounds the runner and exits, so the web request that
 * created the station returns immediately.
 */
function start_backfill_async(int $station_id): void {
    if (!function_exists('proc_open')) {
        return; // shared hosting may forbid it; the cron job still picks the station up
    }
    $php = is_executable('/usr/bin/php') ? '/usr/bin/php' : (PHP_BINARY ?: 'php');
    $command = escapeshellarg($php) . ' ' . escapeshellarg(__DIR__ . '/backfill_runner.php')
        . ' ' . $station_id . ' > /dev/null 2>&1 &';
    $null = ['file', '/dev/null', 'w'];
    $process = @proc_open($command, [0 => ['file', '/dev/null', 'r'], 1 => $null, 2 => $null], $pipes);
    if (is_resource($process)) {
        proc_close($process); // returns at once: the shell has already backgrounded the runner
    }
}
