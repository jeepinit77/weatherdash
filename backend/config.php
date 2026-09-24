<?php
/**
 * Server configuration, read from backend/config.json (never committed).
 * See config.json.example for the expected keys.
 */

function app_config(): array {
    static $config = null;
    if ($config === null) {
        $path = __DIR__ . '/config.json';
        $config = [];
        if (file_exists($path)) {
            $decoded = json_decode((string)file_get_contents($path), true);
            if (is_array($decoded)) {
                $config = $decoded;
            } else {
                // Otherwise a stray comma silently switches sign-in off with no clue why.
                error_log('[weatherdash] config.json exists but is not valid JSON: ' . json_last_error_msg());
            }
        }
    }
    return $config;
}

function google_client_id(): string {
    return trim((string)(app_config()['google_client_id'] ?? ''));
}

/**
 * How this install identifies itself to services whose usage policies ask for
 * a contact: api.weather.gov and Nominatim. Set "user_agent" in config.json to
 * name your site and an address; "nws_user_agent" is its older name. Without
 * either, every install sends the same bare name, which both services may
 * throttle or block.
 */
function contact_user_agent(): string {
    $config = app_config();
    foreach (['user_agent', 'nws_user_agent'] as $key) {
        $value = trim((string)($config[$key] ?? ''));
        if ($value !== '') {
            return $value;
        }
    }
    return 'WeatherDash/1.0';
}

/**
 * Which service forecasts a station's location. 'auto' prefers the National
 * Weather Service where it has coverage and uses Open-Meteo everywhere else.
 */
const FORECAST_PROVIDERS = ['auto', 'nws', 'open-meteo'];

/** A station's chosen provider; anything unrecognised in the database reads as 'auto'. */
function forecast_provider(array $station): string {
    $value = (string)($station['forecast_provider'] ?? 'auto');
    return in_array($value, FORECAST_PROVIDERS, true) ? $value : 'auto';
}

const MAX_STATIONS_PER_USER = 5;
const RAW_RETENTION_DAYS = 90;
const RESERVED_SLUGS = ['api', 'assets', 'backend', 'admin', 'account', 'login', 'logout', 'settings', 'new', 'index', 'favicon', 'icons'];

/** How long a sign-in lasts, and so how long an idle session file is worth keeping. */
const SESSION_LIFETIME = 60 * 60 * 24 * 30;
