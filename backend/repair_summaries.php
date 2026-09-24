<?php
// Rebuilds a station's daily summaries wherever they are missing or were made
// from only part of a day. Run by hand on the server:
//   php repair_summaries.php <station slug> [--dry-run]
//
// Days whose raw readings are still kept are summarized again from them. Days
// the retention prune has already cleared are fetched from Ambient afresh, a
// page or two per day, and summarized before the next prune takes the raw
// readings away again.
//
// It exists because a backfill run cut short by the host, under the code as it
// was before September 23, left stored days unsummarized and summarized the day
// at each 20-day boundary from half its readings.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/ambient.php';
require_once __DIR__ . '/backfill.php';

/** A summary from fewer than this share of a day's five-minute readings was made from part of the day. */
const REPAIR_MIN_SHARE = 0.95;
/** Ambient pages fetched at most for one day: a day is 288 readings, one page, but seldom aligned to it. */
const REPAIR_PAGES_PER_DAY = 3;

$slug = $argv[1] ?? '';
$dry_run = in_array('--dry-run', $argv, true);

$pdo = get_db_connection();
$lookup = $pdo->prepare('SELECT * FROM stations WHERE slug = :slug');
$lookup->execute([':slug' => $slug]);
$station = $lookup->fetch();
if (!$station) {
    fwrite(STDERR, "No station '$slug'\n");
    exit(1);
}
$lock = backfill_try_lock();
if ($lock === null) {
    fwrite(STDERR, "A backfill is running; try again when it is done.\n");
    exit(1);
}

$id = (int)$station['id'];
$zone = new DateTimeZone(current_station_timezone($pdo, $id));
$utc = new DateTimeZone('UTC');
$today = new DateTimeImmutable('today', $zone);

$summaries = $pdo->prepare('SELECT date, reading_count FROM daily_summaries WHERE station_id = :id AND date >= :from');
$summaries->execute([':id' => $id, ':from' => $today->modify('-' . BACKFILL_DAYS . ' days')->format('Y-m-d')]);
$counts = $summaries->fetchAll(PDO::FETCH_KEY_PAIR);

$raw = $pdo->prepare('SELECT COUNT(*) FROM readings WHERE station_id = :id AND recorded_at >= :start AND recorded_at < :end');
$mac = null;
$fixed = 0;
$unchanged = 0;

// Nothing before the station's first summary: that is where its own record begins.
$first = $counts ? min(array_keys($counts)) : $today->format('Y-m-d');
for ($day = new DateTimeImmutable($first, $zone); $day < $today; $day = $day->modify('+1 day')) {
    $date = $day->format('Y-m-d');
    $next = $day->modify('+1 day');
    // 288 on most days, 276 or 300 on the days the clocks change.
    $expected = intdiv($next->getTimestamp() - $day->getTimestamp(), 300);
    $have = isset($counts[$date]) ? (int)$counts[$date] : null;
    if ($have !== null && $have >= $expected * REPAIR_MIN_SHARE) {
        continue;
    }

    $start = $day->setTimezone($utc)->format('Y-m-d H:i:s');
    $end = $next->setTimezone($utc)->format('Y-m-d H:i:s');
    $raw->execute([':id' => $id, ':start' => $start, ':end' => $end]);
    $kept = (int)$raw->fetchColumn();

    if ($kept < $expected * REPAIR_MIN_SHARE) {
        // Not enough kept: ask Ambient for the day, newest page first.
        echo "$date: summary " . ($have ?? 'missing') . ", $kept kept, fetching from Ambient\n";
        if ($dry_run) {
            continue;
        }
        $mac ??= resolve_mac($pdo, $station);
        if ($mac === null) {
            fwrite(STDERR, "Could not determine the station MAC address\n");
            exit(1);
        }
        $cursor = $next->getTimestamp() - 1;
        for ($page = 0; $page < REPAIR_PAGES_PER_DAY && $cursor >= $day->getTimestamp(); $page++) {
            usleep(BACKFILL_REQUEST_GAP_US);
            [$records, $error] = ambient_fetch_history($station['api_key'], $station['application_key'], $mac, $cursor * 1000);
            if ($error) {
                fwrite(STDERR, "$date: $error\n");
                exit(1);
            }
            [, $oldest] = $records ? store_history_page($pdo, $id, $records) : [0, null];
            if ($oldest === null || $oldest >= $cursor) {
                break; // Ambient has nothing older for this day
            }
            $cursor = $oldest - 1;
        }
    } elseif ($dry_run) {
        echo "$date: summary " . ($have ?? 'missing') . ", $kept kept, resummarizing\n";
        continue;
    }

    // Only this day: a neighbour whose raw readings are pruned would be
    // summarized again from the scraps of it a page happened to bring in.
    summarize_days($pdo, $id, [$day]);
    $check = $pdo->prepare('SELECT reading_count FROM daily_summaries WHERE station_id = :id AND date = :date');
    $check->execute([':id' => $id, ':date' => $date]);
    $now = $check->fetchColumn();
    echo "$date: " . ($have ?? 'missing') . ' -> ' . ($now === false ? 'still missing' : $now) . "\n";
    $now !== false && (int)$now > (int)$have ? $fixed++ : $unchanged++;
}

echo ($dry_run ? 'Dry run. ' : '') . "Repaired $fixed days" . ($unchanged ? ", $unchanged could not be improved (the station recorded nothing more)" : '') . ".\n";
