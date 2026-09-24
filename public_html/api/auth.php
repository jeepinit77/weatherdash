<?php
/**
 * Google sign-in (the only way to sign in).
 *
 * GET  ?action=me                       -> { user, googleClientId }
 * POST { action: "nonce" }              -> { nonce }   start a sign-in attempt
 * POST { action: "google", credential } -> { user }    finish it with Google's ID token
 * POST { action: "logout" }
 * POST { action: "delete-account" }     -> { ok: true }  removes the user, their stations and all their data
 *
 * Starting a sign-in is rate limited per client address, since each attempt
 * costs a call to Google.
 */

/** Requests of each sign-in action (nonce, google) allowed per address in AUTH_RATE_WINDOW seconds. */
const AUTH_RATE_MAX = 20;
const AUTH_RATE_WINDOW = 600;

require_once __DIR__ . '/bootstrap.php';

// Reading who is signed in needs no new session; only starting a sign-in does.
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    start_session_if_cookie();
} else {
    start_session();
}
$pdo = get_db_connection();

function user_view(array $user): array {
    return [
        'id' => (int)$user['id'],
        'email' => $user['email'],
        'name' => $user['name'],
        'avatarUrl' => $user['avatar_url'],
        // Set only when the user has asked for one theme on every browser they sign in on.
        'theme' => $user['theme'] ?? null,
    ];
}

function load_current_user(PDO $pdo): ?array {
    $id = current_user_id();
    if ($id === null) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $user = $stmt->fetch();
    if (!$user) {
        unset($_SESSION['user_id']);
        return null;
    }
    return $user;
}

/** Validates a Google ID token and returns its claims, or null if it must be rejected. */
function verify_google_id_token(string $token, string $expected_nonce): ?array {
    $ch = curl_init('https://oauth2.googleapis.com/tokeninfo?' . http_build_query(['id_token' => $token]));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false || $code !== 200) {
        return null;
    }
    $claims = json_decode($resp, true);
    if (!is_array($claims)) {
        return null;
    }

    $valid = ($claims['aud'] ?? '') === google_client_id()
        && in_array($claims['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        && (int)($claims['exp'] ?? 0) > time()
        && in_array($claims['email_verified'] ?? '', ['true', true], true)
        && !empty($claims['sub'])
        && !empty($claims['email'])
        && hash_equals($expected_nonce, (string)($claims['nonce'] ?? ''));

    return $valid ? $claims : null;
}

/**
 * Deletes a user and everything hanging off them. The foreign keys cascade
 * (users -> stations -> readings, daily_summaries; users -> saved_layouts, with foreign_keys switched
 * on for every connection), but the rows are deleted explicitly all the same,
 * child tables first, so the outcome never rests on a pragma or on how an old
 * database's tables happened to be declared.
 */
function delete_user(PDO $pdo, int $user_id): void {
    immediate_transaction($pdo, function () use ($pdo, $user_id) {
        $owned = 'SELECT id FROM stations WHERE user_id = :uid';
        $pdo->prepare("DELETE FROM readings WHERE station_id IN ($owned)")->execute([':uid' => $user_id]);
        $pdo->prepare("DELETE FROM daily_summaries WHERE station_id IN ($owned)")->execute([':uid' => $user_id]);
        $pdo->prepare('DELETE FROM stations WHERE user_id = :uid')->execute([':uid' => $user_id]);
        $pdo->prepare('DELETE FROM saved_layouts WHERE user_id = :uid')->execute([':uid' => $user_id]);
        $pdo->prepare('DELETE FROM users WHERE id = :uid')->execute([':uid' => $user_id]);
    });
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['action'] ?? 'me') !== 'me') {
        fail('Unknown action', 404);
    }
    $user = load_current_user($pdo);
    send_json([
        'user' => $user ? user_view($user) : null,
        'googleClientId' => google_client_id(),
    ]);
}

$body = request_body();

switch ($body['action'] ?? '') {
    case 'nonce':
        rate_limit($pdo, client_ip_bucket('auth-nonce'), AUTH_RATE_MAX, AUTH_RATE_WINDOW);
        $_SESSION['google_nonce'] = bin2hex(random_bytes(16));
        send_json(['nonce' => $_SESSION['google_nonce']]);

    case 'google':
        rate_limit($pdo, client_ip_bucket('auth-google'), AUTH_RATE_MAX, AUTH_RATE_WINDOW);
        if (google_client_id() === '') {
            fail('Google sign-in is not configured on this server', 503);
        }
        $nonce = $_SESSION['google_nonce'] ?? '';
        unset($_SESSION['google_nonce']);
        $credential = trim((string)($body['credential'] ?? ''));
        if ($credential === '' || $nonce === '') {
            fail('Sign-in expired, please try again', 400);
        }

        $claims = verify_google_id_token($credential, $nonce);
        if (!$claims) {
            fail('Google sign-in could not be verified', 401);
        }

        $now = gmdate('Y-m-d H:i:s');
        $pdo->prepare('INSERT INTO users (google_id, email, name, avatar_url, last_login_at)
                VALUES (:gid, :email, :name, :avatar, :now)
                ON CONFLICT(google_id) DO UPDATE SET
                    email = excluded.email, name = excluded.name,
                    avatar_url = excluded.avatar_url, last_login_at = excluded.last_login_at')
            ->execute([
                ':gid' => $claims['sub'],
                ':email' => $claims['email'],
                ':name' => $claims['name'] ?? null,
                ':avatar' => $claims['picture'] ?? null,
                ':now' => $now,
            ]);
        $stmt = $pdo->prepare('SELECT * FROM users WHERE google_id = :gid');
        $stmt->execute([':gid' => $claims['sub']]);
        $user = $stmt->fetch();

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        send_json(['user' => user_view($user)]);

    case 'logout':
        end_session();
        send_json(['ok' => true]);

    case 'delete-account':
        delete_user($pdo, require_user());
        end_session();
        send_json(['ok' => true]);

    default:
        fail('Unknown action', 404);
}
