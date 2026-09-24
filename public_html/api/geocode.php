<?php
/**
 * GET ?q=...          -> { places: [{ name, region, country, latitude, longitude }] }
 * GET ?lat=..&lon=..   -> { place: "Town, Region, Country" | null }
 *
 * Lets owners find their station by place name or postcode instead of entering
 * coordinates, and names the spot the browser reports for "use my location".
 * Both go through the server so the visitor's browser never talks to a third
 * party, and both are cached. Only real answers are cached: when the lookup
 * service is down the request fails (or names no place) this time only, rather
 * than remembering "nowhere" for a month.
 */

const REVERSE_CACHE_LIFETIME = 30 * 86400;
const SEARCH_CACHE_LIFETIME = 86400;

require_once __DIR__ . '/bootstrap.php';

start_session_if_cookie();
require_user();

function fetch_json(string $url): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        // Nominatim's usage policy requires an identifying User-Agent
        CURLOPT_USERAGENT => contact_user_agent(),
    ]);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !$response) {
        return null;
    }
    $data = json_decode($response, true);
    return is_array($data) ? $data : null;
}

// Reverse lookup: name the coordinates the browser gave us.
if (isset($_GET['lat'], $_GET['lon'])) {
    $lat = (float)$_GET['lat'];
    $lon = (float)$_GET['lon'];
    if (abs($lat) > 90 || abs($lon) > 180) {
        fail('Invalid coordinates');
    }
    // Rounded to ~100m, which is plenty to name a place and keeps the cache small
    $lat = round($lat, 3);
    $lon = round($lon, 3);

    $json = cache_remember('reverse_' . md5("$lat,$lon"), REVERSE_CACHE_LIFETIME, REVERSE_CACHE_LIFETIME, function () use ($lat, $lon) {
        $data = fetch_json('https://nominatim.openstreetmap.org/reverse?' . http_build_query([
            'lat' => $lat,
            'lon' => $lon,
            'format' => 'jsonv2',
            'zoom' => 12,
            'addressdetails' => 1,
        ]));
        if ($data === null) {
            return null; // Nominatim is down: not the same as "this spot has no name"
        }
        // A spot with no name (open sea, say) answers with an error and no address.
        $address = $data['address'] ?? [];
        $town = $address['city'] ?? $address['town'] ?? $address['village'] ?? $address['hamlet'] ?? $address['municipality'] ?? $address['county'] ?? null;
        $parts = array_filter([$town, $address['state'] ?? null, $address['country'] ?? null]);
        return json_encode(['place' => $parts ? implode(', ', $parts) : null]);
    });
    if ($json === null) {
        // Naming the spot is a nicety; without it the form still has the coordinates.
        send_json(['place' => null]);
    }
    send_json_text($json);
}

$query = trim((string)($_GET['q'] ?? ''));
if (mb_strlen($query) < 2 || mb_strlen($query) > 80) {
    fail('Enter at least two characters');
}

$json = cache_remember('geocode_' . md5(mb_strtolower($query)), SEARCH_CACHE_LIFETIME, SEARCH_CACHE_LIFETIME, function () use ($query) {
    $data = fetch_json('https://geocoding-api.open-meteo.com/v1/search?' . http_build_query([
        'name' => $query,
        'count' => 6,
        'language' => 'en',
        'format' => 'json',
    ]));
    if ($data === null) {
        return null;
    }
    // A result without coordinates is no use for placing a station; leave it out
    // rather than let it stand at 0, 0.
    $results = array_filter($data['results'] ?? [], fn($place) =>
        is_array($place) && is_numeric($place['latitude'] ?? null) && is_numeric($place['longitude'] ?? null));
    return json_encode(['places' => array_values(array_map(fn($place) => [
        'name' => $place['name'] ?? '',
        'region' => $place['admin1'] ?? '',
        'country' => $place['country'] ?? '',
        'latitude' => round((float)$place['latitude'], 4),
        'longitude' => round((float)$place['longitude'], 4),
    ], $results))]);
});
if ($json === null) {
    fail('Place search is unavailable right now', 502);
}
send_json_text($json);
