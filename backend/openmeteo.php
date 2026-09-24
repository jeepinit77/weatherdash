<?php
/**
 * Open-Meteo's free APIs, which need no key: the forecast (including its
 * 15-minute precipitation) and air quality.
 */

/** GETs an Open-Meteo JSON document. Returns it decoded, or null if it did not answer. */
function open_meteo_get(string $base_url, array $params): ?array {
    $ch = curl_init($base_url . '?' . http_build_query($params));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_USERAGENT => 'WeatherDash/1.0',
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
