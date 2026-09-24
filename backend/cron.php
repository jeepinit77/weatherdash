<?php
// Polls every registered station. Run from cron every 5 minutes:
// */5 * * * * php /path/to/your/site/weatherdash/private/cron.php
// (Not a /** */ block: the "*/" in the schedule would end the comment early.)
//
// Each run: poll every station, patch recent holes in its readings and walk
// its history further back, then prune old raw readings and sweep the cache,
// the session files and the rate-limit counters. Output goes to stdout and to
// logs/cron.log beside this file (inside private/, which the web never serves).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/ambient.php';
require_once __DIR__ . '/backfill.php';

const CRON_LOG_DIR = __DIR__ . '/logs';
const CRON_LOG_FILE = CRON_LOG_DIR . '/cron.log';
/** Past this the log is moved to cron.log.1 (replacing the previous one) and started afresh. */
const CRON_LOG_MAX_BYTES = 1024 * 1024;

/** Echoes a line for whoever runs the job by hand, and keeps it in the log for later. */
function cron_log(string $message): void {
    $line = gmdate('c') . " $message\n";
    echo $line;
    if (!is_dir(CRON_LOG_DIR)) {
        @mkdir(CRON_LOG_DIR, 0750, true);
    }
    clearstatcache(true, CRON_LOG_FILE);
    if (is_file(CRON_LOG_FILE) && filesize(CRON_LOG_FILE) > CRON_LOG_MAX_BYTES) {
        @rename(CRON_LOG_FILE, CRON_LOG_FILE . '.1');
    }
    @file_put_contents(CRON_LOG_FILE, $line, FILE_APPEND | LOCK_EX);
}

/** The same one-line form the API's exception handler logs: never a trace, whose arguments may hold keys. */
function describe_error(Throwable $e): string {
    return sprintf('%s: %s at %s:%d', get_class($e), $e->getMessage(), basename($e->getFile()), $e->getLine());
}

/**
 * A run that outlasts five minutes (a slow Ambient, a long backfill) must not
 * overlap the next one: both would poll every station and page the same history.
 *
 * @return resource|null
 */
function cron_try_lock() {
    $handle = @fopen(__DIR__ . '/cron.lock', 'c');
    if (!$handle || !flock($handle, LOCK_EX | LOCK_NB)) {
        return null;
    }
    return $handle;
}

/**
 * Drops raw readings past the retention window, but only for stations whose
 * history is complete. While a backfill is still walking back through a year,
 * the days it has fetched beyond 90 days would otherwise be cut away between
 * pages, and the day a page ends on re-summarized from half its readings.
 * Those readings go on the first run after the backfill finishes instead.
 */
function prune_readings(PDO $pdo): int {
    $stmt = $pdo->prepare('DELETE FROM readings WHERE recorded_at < :cutoff
        AND station_id IN (SELECT id FROM stations WHERE backfill_complete = 1)');
    $stmt->execute([':cutoff' => gmdate('Y-m-d H:i:s', time() - RAW_RETENTION_DAYS * 86400)]);
    return $stmt->rowCount();
}

/**
 * Removes session files nobody has touched for a whole session lifetime. PHP's
 * own garbage collection is often switched off on shared hosts, which leave
 * cleanup to a system cron that never looks inside this app's folder.
 */
function sweep_sessions(): int {
    $dir = __DIR__ . '/sessions';
    if (!is_dir($dir)) {
        return 0;
    }
    $deleted = 0;
    $cutoff = time() - SESSION_LIFETIME;
    foreach (glob($dir . '/sess_*') ?: [] as $file) {
        if (@filemtime($file) < $cutoff && @unlink($file)) {
            $deleted++;
        }
    }
    return $deleted;
}

/** Rate-limit rows whose window ended long ago; the longest window in use is an hour. */
function sweep_rate_limits(PDO $pdo): int {
    $stmt = $pdo->prepare('DELETE FROM rate_limits WHERE window_start < :cutoff');
    $stmt->execute([':cutoff' => time() - 86400]);
    return $stmt->rowCount();
}

/** Polls one station, then patches its holes and extends its history if that is our job this run. */
function process_station(PDO $pdo, array $station, $backfill_lock): void {
    $slug = $station['slug'];
    if (poll_backoff_active($station)) {
        cron_log("$slug: skipped, keys were rejected; retrying hourly until they are edited");
        return;
    }
    $error = poll_station($pdo, $station);
    cron_log("$slug: " . ($error ?? 'ok'));

    // Paging history is left to whoever holds the backfill lock, so this run
    // and a runner started for a new station never page the same key at once.
    if ($error !== null || $backfill_lock === null) {
        return;
    }
    sleep(2);
    // Re-read: the poll may have set the timezone the summaries are grouped by
    $stmt = $pdo->prepare('SELECT * FROM stations WHERE id = :id');
    $stmt->execute([':id' => $station['id']]);
    $station = $stmt->fetch();
    if (!$station) {
        return; // deleted by its owner meanwhile
    }
    cron_log("$slug: " . gap_fill_step($pdo, $station));
    cron_log("$slug: " . backfill_step($pdo, $station));
}

$cron_lock = cron_try_lock();
if ($cron_lock === null) {
    cron_log('previous run still going, skipping this one');
    exit(0);
}

$pdo = get_db_connection();
$stations = $pdo->query('SELECT * FROM stations ORDER BY id')->fetchAll();

// Polling always runs. Backfilling is skipped while a runner started by a newly
// added station is walking the same history, so the two never fight over SQLite.
$backfill_lock = backfill_try_lock();

foreach ($stations as $i => $station) {
    if ($i > 0) {
        sleep(1); // Ambient allows one request per second per API key
    }
    // One station's bad data or broken keys must not stop the rest, nor the housekeeping below.
    try {
        process_station($pdo, $station, $backfill_lock);
    } catch (Throwable $e) {
        cron_log("{$station['slug']}: failed, " . describe_error($e));
    }
}

$housekeeping = [
    'pruned readings' => fn() => prune_readings($pdo),
    'swept cache files' => fn() => cache_sweep(),
    'swept sessions' => fn() => sweep_sessions(),
    'swept rate limits' => fn() => sweep_rate_limits($pdo),
];
foreach ($housekeeping as $label => $task) {
    try {
        $count = $task();
        if ($count > 0) {
            cron_log("$label: $count");
        }
    } catch (Throwable $e) {
        cron_log("$label: failed, " . describe_error($e));
    }
}
