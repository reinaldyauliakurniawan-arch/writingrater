<?php
// Router untuk uji lokal dengan server bawaan PHP (meniru htdocs/.htaccess):
//   php -S localhost:8000 -t htdocs scripts/php-router.php
$root = $_SERVER['DOCUMENT_ROOT'];
$path = urldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
if (preg_match('#^/(app|storage)(/|$)|^/config(\.sample)?\.php$#', $path)) {
    http_response_code(403);
    exit('Forbidden');
}
if ($path !== '/' && is_file($root . $path) && !str_ends_with($path, '.php')) return false;
require $root . '/index.php';
