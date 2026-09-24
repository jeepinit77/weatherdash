<?php
/**
 * What a signed-in user keeps with their account rather than in one browser.
 *
 * GET  ?action=layouts                              -> { layouts }  the user's saved layouts, newest first
 * POST { action: "save-layout", id?, name, layout } -> { layout }   create, or replace one you own
 * POST { action: "delete-layout", id }              -> { ok: true }
 * POST { action: "theme", theme }                   -> { theme }    a theme id, or null to stop sharing one
 *
 * A saved layout is never applied by itself: the viewer picks one in the
 * dashboard editor. The theme is the exception, and only once the user has
 * asked for it: every browser they sign in on then takes it up.
 */

require_once __DIR__ . '/bootstrap.php';

/** Saved layouts one user may keep. */
const MAX_SAVED_LAYOUTS = 30;
const MAX_LAYOUT_NAME = 60;
/** Items in one layout: generous against the ~20 widgets and their row breaks. */
const MAX_LAYOUT_ITEMS = 100;
const MAX_LAYOUT_ID = 40;

/** The ids in src/lib/theme.ts THEMES. */
const THEME_IDS = ['midnight', 'paper', 'chalk', 'terracotta'];

start_session();
$pdo = get_db_connection();
$user_id = require_user();

function layout_view(array $row): array {
    return [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'layout' => json_decode($row['layout'], true) ?? [],
        'updatedAt' => utc_to_iso($row['updated_at']),
    ];
}

/**
 * The layout as the browser stores it, keeping only what that format holds.
 * Which ids are real widgets is the browser's business (it drops ones it does
 * not know when it reads the layout back), so this checks shape, not names.
 */
function clean_layout($layout): array {
    if (!is_array($layout) || !array_is_list($layout) || count($layout) === 0 || count($layout) > MAX_LAYOUT_ITEMS) {
        fail('Invalid layout');
    }
    $clean = [];
    foreach ($layout as $item) {
        $id = is_array($item) ? ($item['id'] ?? null) : null;
        if (!is_string($id) || $id === '' || strlen($id) > MAX_LAYOUT_ID || !preg_match('/^[a-z0-9-]+$/', $id)) {
            fail('Invalid layout');
        }
        if (array_key_exists('columns', $item)) {
            $columns = $item['columns'];
            $clean[] = ['id' => $id, 'columns' => is_int($columns) && $columns >= 1 && $columns <= 12 ? $columns : null];
        } else {
            $clean[] = ['id' => $id, 'enabled' => (bool)($item['enabled'] ?? false)];
        }
    }
    return $clean;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['action'] ?? '') !== 'layouts') {
        fail('Unknown action', 404);
    }
    $stmt = $pdo->prepare('SELECT * FROM saved_layouts WHERE user_id = :uid ORDER BY updated_at DESC, id DESC');
    $stmt->execute([':uid' => $user_id]);
    send_json(['layouts' => array_map('layout_view', $stmt->fetchAll())]);
}

$body = request_body();

switch ($body['action'] ?? '') {
    case 'save-layout':
        $name = trim(preg_replace('/\s+/u', ' ', (string)($body['name'] ?? '')));
        if ($name === '') {
            fail('Give the layout a name');
        }
        if (mb_strlen($name) > MAX_LAYOUT_NAME) {
            fail('That name is too long');
        }
        $layout = json_encode(clean_layout($body['layout'] ?? null));
        $id = (int)($body['id'] ?? 0);
        $now = gmdate('Y-m-d H:i:s');

        $saved_id = immediate_transaction($pdo, function () use ($pdo, $user_id, $id, $name, $layout, $now) {
            if ($id > 0) {
                $stmt = $pdo->prepare('UPDATE saved_layouts SET name = :name, layout = :layout, updated_at = :now
                    WHERE id = :id AND user_id = :uid');
                $stmt->execute([':name' => $name, ':layout' => $layout, ':now' => $now, ':id' => $id, ':uid' => $user_id]);
                return $stmt->rowCount() > 0 ? $id : null;
            }
            $count = $pdo->prepare('SELECT COUNT(*) FROM saved_layouts WHERE user_id = :uid');
            $count->execute([':uid' => $user_id]);
            if ((int)$count->fetchColumn() >= MAX_SAVED_LAYOUTS) {
                return 0;
            }
            $pdo->prepare('INSERT INTO saved_layouts (user_id, name, layout, created_at, updated_at)
                    VALUES (:uid, :name, :layout, :now, :now)')
                ->execute([':uid' => $user_id, ':name' => $name, ':layout' => $layout, ':now' => $now]);
            return (int)$pdo->lastInsertId();
        });

        if ($saved_id === null) {
            fail('Layout not found', 404);
        }
        if ($saved_id === 0) {
            fail('You can keep up to ' . MAX_SAVED_LAYOUTS . ' layouts. Delete one to save another.', 409);
        }
        $stmt = $pdo->prepare('SELECT * FROM saved_layouts WHERE id = :id');
        $stmt->execute([':id' => $saved_id]);
        send_json(['layout' => layout_view($stmt->fetch())]);

    case 'delete-layout':
        $pdo->prepare('DELETE FROM saved_layouts WHERE id = :id AND user_id = :uid')
            ->execute([':id' => (int)($body['id'] ?? 0), ':uid' => $user_id]);
        send_json(['ok' => true]);

    case 'theme':
        $theme = $body['theme'] ?? null;
        if ($theme !== null && !in_array($theme, THEME_IDS, true)) {
            fail('Unknown theme');
        }
        $pdo->prepare('UPDATE users SET theme = :theme WHERE id = :uid')->execute([':theme' => $theme, ':uid' => $user_id]);
        send_json(['theme' => $theme]);

    default:
        fail('Unknown action', 404);
}
