<?php
declare(strict_types=1);

// Front controller: semua URL (kecuali file statis di assets/) masuk ke sini lewat .htaccess.

define('REQUEST_START', microtime(true));
require __DIR__ . '/app/bootstrap.php';

$path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');

start_session();
if ($path !== '/install') ensure_schema();

if (str_starts_with($path, '/api/')) {
    require APP_DIR . '/api.php';
    api_dispatch($path);
} else {
    require APP_DIR . '/pages.php';
    page_dispatch($path);
}
