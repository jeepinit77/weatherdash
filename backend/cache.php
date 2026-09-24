<?php
/**
 * The file cache the API endpoints keep of upstream answers (forecasts, alerts,
 * archive records, place names, NWS grid lookups), in backend/cache.
 *
 * Every endpoint used to carry its own copy of the read/check-age/write dance.
 * Keeping it here means one place decides three things they all need: that a
 * half-written file is never read (writes go to a temp file and are renamed
 * into place), that only one request at a time refreshes an expired entry
 * (the rest serve the stale copy instead of all hitting the upstream at once),
 * and how long each kind of file may linger before cron sweeps it away.
 */

const CACHE_DIR = __DIR__ . '/cache';

/**
 * The longest any file with this key prefix is still useful to anyone, fresh or
 * stale, in seconds. cache_sweep() deletes files older than this. The first
 * matching prefix wins, so longer prefixes sharing a stem must come first.
 */
const CACHE_MAX_AGES = [
    'forecast_' => 86400,            // the old forecast files, no longer written
    'forecast2_' => 86400,           // fresh 30 min, served stale for up to a day
    'nowcast_' => 3600,              // fresh 10 min, served stale for up to an hour
    'airquality_' => 86400,          // fresh 30 min, served stale for up to a day
    'moonimg_' => 6 * 3600,          // NASA's moon picture for the hour: fresh 1 hour, stale 6
    'alerts_' => 3600,               // fresh 5 min, served stale for up to an hour
    'recordtable_' => 60 * 86400,    // the old records tables, no longer written
    'recordtable2_' => 60 * 86400,   // records and normals: fresh 30 days, served stale for 30 more
    'records_' => 86400,             // the old per-day records files, no longer written
    'geocode_' => 86400,             // place search, one day
    'reverse_' => 30 * 86400,        // naming a coordinate, thirty days
    'nws_point_miss_' => 86400,      // "NWS does not cover this point", one day
    'nws_point_' => 30 * 86400,      // grid square lookups, thirty days
];

/** Anything in the cache no prefix above accounts for. */
const CACHE_DEFAULT_MAX_AGE = 31 * 86400;

/** Slack on top of each lifetime, so a file is never swept while it is still being served. */
const CACHE_SWEEP_MARGIN = 3600;

function cache_dir(): string {
    if (!is_dir(CACHE_DIR)) {
        @mkdir(CACHE_DIR, 0750, true);
    }
    return CACHE_DIR;
}

/** Keys become file names, so they may only hold characters that are safe in one. */
function cache_path(string $key): string {
    if (!preg_match('/^[a-z0-9_]+$/i', $key)) {
        throw new InvalidArgumentException("Unsafe cache key: $key");
    }
    return cache_dir() . '/' . $key . '.json';
}

/** The cached text for a key, or null if there is none younger than $max_age seconds. */
function cache_get(string $key, int $max_age): ?string {
    $file = cache_path($key);
    clearstatcache(true, $file);
    if (!is_file($file) || time() - (int)filemtime($file) >= $max_age) {
        return null;
    }
    $text = @file_get_contents($file);
    return $text === false || $text === '' ? null : $text;
}

/**
 * Stores text under a key. Written beside the real file and renamed over it,
 * which is atomic, so a reader sees either the old copy or the new one and
 * never a torn half of each.
 */
function cache_put(string $key, string $text): void {
    $file = cache_path($key);
    $temp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($temp, $text) === false) {
        return; // a cache that cannot be written is only slower, never wrong
    }
    if (!@rename($temp, $file)) {
        @unlink($temp);
    }
}

/**
 * Takes the refresh lock for a key. Non-blocking by default: null means some
 * other request is refreshing it right now. With $wait it blocks until that
 * request is done, and null then only means the lock file could not be opened.
 *
 * @return resource|null
 */
function cache_lock(string $key, bool $wait = false) {
    $handle = @fopen(cache_dir() . '/' . $key . '.lock', 'c');
    if (!$handle) {
        return null;
    }
    if (!flock($handle, $wait ? LOCK_EX : LOCK_EX | LOCK_NB)) {
        fclose($handle);
        return null;
    }
    return $handle;
}

/** @param resource|null $handle */
function cache_unlock($handle): void {
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/**
 * The cached text for a key, refreshed by $fetch once it is older than $ttl.
 *
 * $fetch returns the new text, or null when the upstream failed. A failure is
 * never cached: the stale copy (up to $stale_ttl old) is returned instead, or
 * null when there is none, so an outage cannot pin a wrong answer in place.
 *
 * Only one request refreshes a given key at a time. The others serve the stale
 * copy meanwhile; if there is none yet, they wait for the refresh to land and
 * use its result, rather than every visitor calling the upstream at once.
 */
function cache_remember(string $key, int $ttl, int $stale_ttl, callable $fetch): ?string {
    $fresh = cache_get($key, $ttl);
    if ($fresh !== null) {
        return $fresh;
    }
    $lock = cache_lock($key);
    if ($lock === null) {
        $stale = cache_get($key, $stale_ttl);
        if ($stale !== null) {
            return $stale;
        }
        $lock = cache_lock($key, true);
        $fresh = cache_get($key, $ttl);
        if ($fresh !== null) {
            cache_unlock($lock);
            return $fresh;
        }
    }
    try {
        $text = $fetch();
        if (is_string($text)) {
            cache_put($key, $text);
            return $text;
        }
        return cache_get($key, $stale_ttl);
    } finally {
        cache_unlock($lock);
    }
}

/** The longest a cache file of this name can still be of use. */
function cache_max_age(string $name): int {
    foreach (CACHE_MAX_AGES as $prefix => $age) {
        if (str_starts_with($name, $prefix)) {
            return $age;
        }
    }
    return CACHE_DEFAULT_MAX_AGE;
}

/**
 * Deletes cache files nobody can use any more. Nothing else ever removes them,
 * and every coordinate ever searched for leaves one behind. Lock files are only
 * removed when nobody holds them. Returns how many files went.
 */
function cache_sweep(): int {
    if (!is_dir(CACHE_DIR)) {
        return 0;
    }
    $now = time();
    $deleted = 0;
    foreach (new DirectoryIterator(CACHE_DIR) as $entry) {
        if (!$entry->isFile()) {
            continue;
        }
        $name = $entry->getFilename();
        $age = $now - $entry->getMTime();
        $path = $entry->getPathname();

        if (str_ends_with($name, '.lock')) {
            if ($age > 86400 && ($handle = @fopen($path, 'c'))) {
                if (flock($handle, LOCK_EX | LOCK_NB)) {
                    $deleted += @unlink($path) ? 1 : 0;
                }
                fclose($handle);
            }
            continue;
        }
        // A temp file this old belongs to a write that died halfway.
        $limit = str_ends_with($name, '.tmp') ? 3600 : cache_max_age($name) + CACHE_SWEEP_MARGIN;
        if ($age > $limit && @unlink($path)) {
            $deleted++;
        }
    }
    return $deleted;
}
