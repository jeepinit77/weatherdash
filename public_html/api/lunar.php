<?php
/**
 * GET -> NASA's picture of the moon for the current hour, from the Scientific
 * Visualization Studio's Dial-A-Moon: a rendering of the real moon for every
 * hour of the year, with its true phase and libration, in the public domain.
 * Returns the image URLs (north up, and south up for the southern hemisphere);
 * the browser loads the image from NASA itself.
 *
 * The API only answers browsers from one other site, so this asks on the
 * page's behalf, once an hour for everyone.
 *
 * Not called moon.php: the host's firewall refuses any request for a file of
 * that name, a common name for planted web shells.
 */

const MOON_CACHE_LIFETIME = 3600;
const MOON_STALE_LIFETIME = 6 * 3600;

require_once __DIR__ . '/bootstrap.php';
require_once BACKEND_DIR . '/cache.php';

$hour = gmdate('Y-m-d\TH:00');

$payload = cache_remember('moonimg_' . gmdate('YmdH'), MOON_CACHE_LIFETIME, MOON_STALE_LIFETIME, function () use ($hour): ?string {
    $ch = curl_init('https://svs.gsfc.nasa.gov/api/dialamoon/' . $hour);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_USERAGENT => 'WeatherDash/1.0',
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = $code === 200 && $response ? json_decode($response, true) : null;
    $north = $data['image']['url'] ?? null;
    if (!is_string($north) || !str_starts_with($north, 'https://svs.gsfc.nasa.gov/')) {
        return null;
    }
    $south = $data['su_image']['url'] ?? null;
    return json_encode([
        'time' => $hour,
        'north' => $north,
        'south' => is_string($south) && str_starts_with($south, 'https://svs.gsfc.nasa.gov/') ? $south : $north,
    ]);
});
if ($payload === null) {
    fail('The moon picture is temporarily unavailable', 502);
}
send_json_text($payload);
