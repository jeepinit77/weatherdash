<?php
/**
 * SQLite connection and schema.
 *
 * The schema is versioned with PRAGMA user_version. Version 2 is a clean start:
 * it drops the prototype tables (seeded "main" station, password table,
 * slug-keyed readings) instead of migrating them. Version 3 adds each station's
 * own Ambient application key. Version 4 tracks how far back history has been
 * backfilled from Ambient. Version 5 records more detail per day, since
 * summaries are kept forever while raw readings are pruned after 90 days.
 * Version 6 lets each station choose which service forecasts its location.
 * Version 7 indexes readings and summaries by time (the retention prune and the
 * date windows scan them that way), adds the rate_limits table, and records how
 * far each station's readings have been checked for gaps left by outages.
 * Version 8 keeps more of what the station reports: event and yearly rain, the
 * time of the last rain, and the indoor feels-like and dew point. Version 9
 * lets a signed-in user keep named dashboard layouts, and a theme that follows
 * them to every browser they sign in on.
 *
 * Each step runs in its own write transaction together with the user_version
 * bump that records it, so a step either lands completely or not at all. A
 * failure part way down the chain leaves the database at the last finished
 * version, and the next request resumes from there instead of re-running a
 * half-applied step forever (a second ALTER TABLE ADD COLUMN would fail).
 */

const SCHEMA_VERSION = 9;

/** Added in v5; also part of the fresh-install daily_summaries table below. */
const SUMMARY_V5_COLUMNS = [
    'reading_count' => 'INTEGER',
    'wind_dir_avg' => 'INTEGER',
    'feels_like_max' => 'REAL',
    'feels_like_min' => 'REAL',
    'humidity_min' => 'REAL',
    'humidity_max' => 'REAL',
    'dew_point_max' => 'REAL',
    'dew_point_min' => 'REAL',
    'barom_min' => 'REAL',
    'barom_max' => 'REAL',
    'rain_rate_max' => 'REAL',
];

/** Added to readings in v8; also part of a fresh install. */
const READING_V8_COLUMNS = [
    'event_rain' => 'REAL',
    'yearly_rain' => 'REAL',
    'feels_like_in' => 'REAL',
    'dew_point_in' => 'REAL',
    // Unix seconds, UTC.
    'last_rain' => 'INTEGER',
];

/** Upgrade steps: the version a database is at => the function that lifts it one version. */
const MIGRATION_STEPS = [
    2 => 'migrate_v2_to_v3',
    3 => 'migrate_v3_to_v4',
    4 => 'migrate_v4_to_v5',
    5 => 'migrate_v5_to_v6',
    6 => 'migrate_v6_to_v7',
    7 => 'migrate_v7_to_v8',
    8 => 'migrate_v8_to_v9',
];

function get_db_connection(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $db_dir = __DIR__ . '/db';
        if (!is_dir($db_dir)) {
            mkdir($db_dir, 0750, true);
        }
        $pdo = new PDO('sqlite:' . $db_dir . '/weather.sqlite');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        migrate($pdo);
    }
    return $pdo;
}

/**
 * Runs $work inside BEGIN IMMEDIATE, which takes SQLite's write lock up front.
 * A plain BEGIN only takes it at the first write, so two requests can both read
 * ("4 stations, room for one more") before either writes; IMMEDIATE makes the
 * second wait until the first has committed, and then read the new truth.
 *
 * $work must not exit the script (fail(), send_json()): return a value and act
 * on it after the commit instead.
 */
function immediate_transaction(PDO $pdo, callable $work) {
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $result = $work();
        $pdo->exec('COMMIT');
        return $result;
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}

function schema_version(PDO $pdo): int {
    return (int)$pdo->query('PRAGMA user_version')->fetchColumn();
}

function migrate(PDO $pdo): void {
    while (schema_version($pdo) < SCHEMA_VERSION) {
        if (schema_version($pdo) < 2) {
            // Only settable outside a transaction. The prototype tables being
            // dropped may reference each other in ways the new schema does not.
            $pdo->exec('PRAGMA foreign_keys = OFF');
            try {
                immediate_transaction($pdo, function () use ($pdo) {
                    if (schema_version($pdo) < 2) { // another request may have got here first
                        create_schema($pdo);
                    }
                });
            } finally {
                $pdo->exec('PRAGMA foreign_keys = ON');
            }
            continue;
        }
        immediate_transaction($pdo, function () use ($pdo) {
            // Re-read under the write lock: a concurrent request may have just
            // applied this very step, and it must not be applied twice.
            $version = schema_version($pdo);
            if ($version >= SCHEMA_VERSION) {
                return;
            }
            if (!isset(MIGRATION_STEPS[$version])) {
                throw new RuntimeException("No migration from schema version $version");
            }
            (MIGRATION_STEPS[$version])($pdo);
            $pdo->exec('PRAGMA user_version = ' . ($version + 1));
        });
    }
}

function migrate_v2_to_v3(PDO $pdo): void {
    $pdo->exec("ALTER TABLE stations ADD COLUMN application_key TEXT NOT NULL DEFAULT ''");
}

function migrate_v3_to_v4(PDO $pdo): void {
    $pdo->exec('ALTER TABLE stations ADD COLUMN backfill_cursor TEXT');
    $pdo->exec('ALTER TABLE stations ADD COLUMN backfill_complete INTEGER NOT NULL DEFAULT 0');
}

function migrate_v4_to_v5(PDO $pdo): void {
    foreach (SUMMARY_V5_COLUMNS as $column => $type) {
        $pdo->exec("ALTER TABLE daily_summaries ADD COLUMN $column $type");
    }
}

function migrate_v5_to_v6(PDO $pdo): void {
    $pdo->exec("ALTER TABLE stations ADD COLUMN forecast_provider TEXT NOT NULL DEFAULT 'auto'");
}

function migrate_v6_to_v7(PDO $pdo): void {
    $pdo->exec('ALTER TABLE stations ADD COLUMN gap_checked_to TEXT');
    create_v7_objects($pdo);
}

function migrate_v7_to_v8(PDO $pdo): void {
    add_v8_columns($pdo);
}

function migrate_v8_to_v9(PDO $pdo): void {
    $pdo->exec('ALTER TABLE users ADD COLUMN theme TEXT');
    create_v9_objects($pdo);
}

/** Named layouts a user has saved. Shared by the upgrade and the fresh install. */
function create_v9_objects(PDO $pdo): void {
    // layout is the JSON list the browser stores: [{id, enabled} | {id, columns}].
    $pdo->exec('CREATE TABLE IF NOT EXISTS saved_layouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        layout TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_saved_layouts_user ON saved_layouts(user_id)');
}

function add_v8_columns(PDO $pdo): void {
    foreach (READING_V8_COLUMNS as $column => $type) {
        $pdo->exec("ALTER TABLE readings ADD COLUMN $column $type");
    }
}

/** The v7 indexes and table; shared by the upgrade and the fresh install. */
function create_v7_objects(PDO $pdo): void {
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_readings_recorded_at ON readings(recorded_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date)');

    // One row per limited thing (e.g. "auth:<hashed ip>"), counting hits in a fixed window.
    $pdo->exec('CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        hits INTEGER NOT NULL
    )');
}

/** The whole current schema, for a database with nothing worth keeping. */
function create_schema(PDO $pdo): void {
    foreach (['saved_layouts', 'widget_layouts', 'user_passwords', 'daily_summaries', 'readings', 'stations', 'users', 'rate_limits'] as $table) {
        $pdo->exec("DROP TABLE IF EXISTS $table");
    }

    $pdo->exec("CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT,
        theme TEXT
    )");

    $pdo->exec("CREATE TABLE stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        application_key TEXT NOT NULL,
        mac_address TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timezone TEXT,
        forecast_provider TEXT NOT NULL DEFAULT 'auto',
        is_public INTEGER NOT NULL DEFAULT 1,
        last_poll_at TEXT,
        last_poll_error TEXT,
        backfill_cursor TEXT,
        backfill_complete INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        gap_checked_to TEXT
    )");
    $pdo->exec("CREATE INDEX idx_stations_user ON stations(user_id)");

    // recorded_at is always UTC, 'YYYY-MM-DD HH:MM:SS'
    $pdo->exec("CREATE TABLE readings (
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        recorded_at TEXT NOT NULL,
        tempf REAL,
        feels_like REAL,
        dew_point REAL,
        humidity REAL,
        temp_in REAL,
        humidity_in REAL,
        barom_rel REAL,
        barom_abs REAL,
        wind_speed REAL,
        wind_gust REAL,
        max_daily_gust REAL,
        wind_dir INTEGER,
        hourly_rain REAL,
        daily_rain REAL,
        weekly_rain REAL,
        monthly_rain REAL,
        total_rain REAL,
        solar_radiation REAL,
        uv INTEGER,
        batt_out INTEGER,
        PRIMARY KEY (station_id, recorded_at)
    )");

    // date is the station's local calendar date, 'YYYY-MM-DD'
    $pdo->exec("CREATE TABLE daily_summaries (
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        temp_min REAL,
        temp_max REAL,
        temp_avg REAL,
        dew_point_avg REAL,
        humidity_avg REAL,
        barom_avg REAL,
        wind_avg REAL,
        wind_max REAL,
        rain_total REAL,
        solar_max REAL,
        uv_max INTEGER,
        reading_count INTEGER,
        wind_dir_avg INTEGER,
        feels_like_max REAL,
        feels_like_min REAL,
        humidity_min REAL,
        humidity_max REAL,
        dew_point_max REAL,
        dew_point_min REAL,
        barom_min REAL,
        barom_max REAL,
        rain_rate_max REAL,
        PRIMARY KEY (station_id, date)
    )");

    create_v7_objects($pdo);
    add_v8_columns($pdo);
    create_v9_objects($pdo);

    $pdo->exec('PRAGMA user_version = ' . SCHEMA_VERSION);
}
