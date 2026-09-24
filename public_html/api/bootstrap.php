<?php
/**
 * Locates the backend code. Everything the app owns lives under one folder:
 * on the server that is weatherdash/ in the web root, where these endpoints sit in
 * api/ and the backend sits alongside them in private/ (an .htaccess there
 * denies the web server, so only PHP can reach it). In the repo the same code
 * lives in ../../backend. Resolving by __DIR__ rather than an absolute path
 * keeps this working if the folder is ever moved or renamed.
 */

$deployed_backend = dirname(__DIR__) . '/private';
define('BACKEND_DIR', is_dir($deployed_backend) ? $deployed_backend : dirname(__DIR__, 2) . '/backend');

require_once BACKEND_DIR . '/http.php';
