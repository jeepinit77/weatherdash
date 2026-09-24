<?php
/**
 * Fills in one station's history straight after it is added, instead of leaving
 * it blank until the next cron tick. Started detached by start_backfill_async().
 *
 * It walks the same BACKFILL_DAYS_PER_RUN pages the cron job does, looping until
 * the station's year is in, so a new station is usually complete within the hour.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/backfill.php';

$station_id = (int)($argv[1] ?? 0);
if ($station_id <= 0) {
    exit(1);
}

/** Held for the whole run so the cron job skips backfilling while this works. */
$lock = backfill_try_lock();
if ($lock === null) {
    exit(0); // the cron job or another runner is already walking the history
}

$pdo = get_db_connection();
$stmt = $pdo->prepare('SELECT * FROM stations WHERE id = :id');

/** A year at BACKFILL_DAYS_PER_RUN a time, with headroom; the lock frees on exit either way. */
$max_passes = (int)ceil(BACKFILL_DAYS / BACKFILL_DAYS_PER_RUN) + 5;

for ($pass = 0; $pass < $max_passes; $pass++) {
    $stmt->execute([':id' => $station_id]);
    $station = $stmt->fetch();
    if (!$station || (int)$station['backfill_complete'] === 1) {
        break;
    }
    $status = backfill_step($pdo, $station);
    if (str_contains($status, 'paused') || str_contains($status, 'could not determine')) {
        break; // Ambient is rate limiting or the station is misconfigured; cron retries later
    }
}
