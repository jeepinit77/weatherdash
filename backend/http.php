<?php
/**
 * Shared helpers for the JSON API endpoints in public_html/api.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/cache.php';

const SESSION_COOKIE = 'weatherdash_sid';

set_exception_handler(function (Throwable $e) {
    // Class, message and place only. The full trace prints each frame's
    // arguments, and those can include a station's Ambient keys.
    error_log(sprintf('[weatherdash] %s: %s at %s:%d', get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
    send_json(['error' => 'Internal server error'], 500);
});

function send_json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

/** Sends text that is already JSON, such as a cached upstream answer, without decoding it. */
function send_json_text(string $json, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo $json;
    exit;
}

function fail(string $message, int $status = 400): never {
    send_json(['error' => $message], $status);
}

/**
 * The URL path the app is served under, with a trailing slash: "/weatherdash/"
 * on the server, "/" when the api folder sits at the root in development.
 * Worked out from this request's own script path (…/api/auth.php), so moving
 * or renaming the app's folder needs no change here.
 */
function app_base_path(): string {
    $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
    if ($script === '' || !str_starts_with($script, '/')) {
        return '/';
    }
    $base = rtrim(str_replace('\\', '/', dirname($script, 2)), '/');
    return $base . '/';
}

/** Cookie attributes shared by the session cookie and every cookie that expires it. */
function session_cookie_options(int $expires, string $path): array {
    return [
        'expires' => $expires,
        'path' => $path,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function configure_session(): void {
    static $configured = false;
    if ($configured) {
        return;
    }
    $configured = true;

    $save_path = __DIR__ . '/sessions';
    if (!is_dir($save_path)) {
        mkdir($save_path, 0750, true);
    }
    session_save_path($save_path);
    ini_set('session.gc_maxlifetime', (string)SESSION_LIFETIME);
    // Refuse session ids this server never issued, so nobody can plant one on a
    // visitor's browser and wait for them to sign in under it.
    ini_set('session.use_strict_mode', '1');
    session_name(SESSION_COOKIE);
    // Scoped to the app's own folder: the other apps on this domain never see it.
    $options = session_cookie_options(0, app_base_path());
    unset($options['expires']);
    session_set_cookie_params(['lifetime' => SESSION_LIFETIME] + $options);
}

function start_session(): void {
    configure_session();
    session_start();
    retire_legacy_session_cookie();
}

/**
 * Starts the session only for a browser that already has one. Public pages are
 * read by anonymous visitors all day, and each of those would otherwise leave a
 * fresh session file behind. Returns whether a session was started.
 */
function start_session_if_cookie(): bool {
    if (empty($_COOKIE[SESSION_COOKIE])) {
        return false;
    }
    start_session();
    return true;
}

/**
 * The session cookie used to be set for the whole domain (path "/"). A browser
 * that still holds that one would keep sending it next to the new, app-scoped
 * one, so once per session it is expired, and the session id is re-issued under
 * the app path: PHP only sends the cookie itself when it creates a new id, and
 * the id in use may well have arrived on the old cookie.
 */
function retire_legacy_session_cookie(): void {
    $path = app_base_path();
    if ($path === '/' || ($_SESSION['cookie_path'] ?? null) === $path || headers_sent()) {
        return;
    }
    setcookie(SESSION_COOKIE, '', session_cookie_options(time() - 3600, '/'));
    setcookie(SESSION_COOKIE, session_id(), session_cookie_options(time() + SESSION_LIFETIME, $path));
    $_SESSION['cookie_path'] = $path;
}

/** Signs the browser out completely: the session file and the cookie that named it. */
function end_session(): void {
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    if (!headers_sent()) {
        setcookie(SESSION_COOKIE, '', session_cookie_options(time() - 3600, app_base_path()));
    }
}

/** Parses a JSON POST body. Requiring the JSON content type blocks cross-site form posts. */
function request_body(): array {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed', 405);
    }
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        fail('Expected a JSON body', 415);
    }
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        fail('Invalid JSON body');
    }
    return $data;
}

function current_user_id(): ?int {
    return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
}

function require_user(): int {
    $id = current_user_id();
    if ($id === null) {
        fail('Sign in required', 401);
    }
    return $id;
}

/**
 * Counts one hit against $bucket and answers 429 once it has had more than $max
 * in the current $window seconds. A fixed window, not a sliding one: crude, but
 * all it has to do is stop a script hammering sign-in or station saves, and each
 * of those costs a call to Google or Ambient.
 */
function rate_limit(PDO $pdo, string $bucket, int $max, int $window): void {
    $now = time();
    $pdo->prepare('INSERT INTO rate_limits (bucket, window_start, hits) VALUES (:bucket, :now, 1)
            ON CONFLICT(bucket) DO UPDATE SET
                hits = CASE WHEN window_start <= :expired THEN 1 ELSE hits + 1 END,
                window_start = CASE WHEN window_start <= :expired2 THEN :now2 ELSE window_start END')
        ->execute([
            ':bucket' => $bucket,
            ':now' => $now,
            ':expired' => $now - $window,
            ':expired2' => $now - $window,
            ':now2' => $now,
        ]);
    $stmt = $pdo->prepare('SELECT hits FROM rate_limits WHERE bucket = :bucket');
    $stmt->execute([':bucket' => $bucket]);
    if ((int)$stmt->fetchColumn() > $max) {
        fail('Too many requests, try again in a few minutes', 429);
    }
}

/** A stable bucket name for the caller's address, without keeping the address itself. */
function client_ip_bucket(string $prefix): string {
    return $prefix . ':' . substr(hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? '')), 0, 32);
}

function find_station_by_slug(PDO $pdo, string $slug): ?array {
    $stmt = $pdo->prepare('SELECT * FROM stations WHERE slug = :slug');
    $stmt->execute([':slug' => strtolower(trim($slug))]);
    return $stmt->fetch() ?: null;
}

function require_station_from_query(PDO $pdo): array {
    $station = find_station_by_slug($pdo, (string)($_GET['slug'] ?? ''));
    if (!$station) {
        fail('Station not found', 404);
    }
    return $station;
}

/** The station's own time zone, or UTC while it is not yet known. */
function station_timezone(array $station): DateTimeZone {
    try {
        return new DateTimeZone((string)($station['timezone'] ?? '') ?: 'UTC');
    } catch (Exception $e) {
        return new DateTimeZone('UTC');
    }
}

/**
 * The station's local calendar date, moved by $modify (e.g. "-6 days"), as
 * 'YYYY-MM-DD'. Daily summaries are keyed by local date, so windows over them
 * must start from the station's today, not the server's UTC one.
 */
function station_local_date(array $station, string $modify): string {
    return (new DateTimeImmutable('today', station_timezone($station)))->modify($modify)->format('Y-m-d');
}

function utc_to_iso(?string $utc): ?string {
    return $utc === null ? null : str_replace(' ', 'T', $utc) . 'Z';
}

function num_or_null($value): ?float {
    return $value === null ? null : (float)$value;
}

/** Station fields that are safe to show to anyone who has the link (no exact location). */
function station_public_view(array $station): array {
    return [
        'slug' => $station['slug'],
        'name' => $station['name'],
        'timezone' => $station['timezone'],
        'isPublic' => (bool)$station['is_public'],
        'lastPollAt' => utc_to_iso($station['last_poll_at']),
    ];
}

/** Station fields shown to the station's owner. Never includes the full keys. */
function station_owner_view(array $station): array {
    return station_public_view($station) + [
        'id' => (int)$station['id'],
        'macAddress' => $station['mac_address'],
        'latitude' => (float)$station['latitude'],
        'longitude' => (float)$station['longitude'],
        'forecastProvider' => $station['forecast_provider'] ?? 'auto',
        'apiKeyHint' => '••••' . substr($station['api_key'], -4),
        'appKeyHint' => $station['application_key'] === '' ? '' : '••••' . substr($station['application_key'], -4),
        'lastPollError' => $station['last_poll_error'],
        'backfillComplete' => (bool)$station['backfill_complete'],
        'backfilledTo' => utc_to_iso($station['backfill_cursor']),
    ];
}
