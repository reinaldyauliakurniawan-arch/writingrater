<?php
declare(strict_types=1);

// Dimuat paling awal oleh index.php: konfigurasi, database, sesi login, error, dan helper umum.

const APP_NAME = 'IELTS Writing Rater';
const APP_TIMEZONE = 'Asia/Jakarta';
const PROMPT_VERSION = 'v1.2.0'; // naikkan setiap prompt/KB berubah
const MIN_WORDS = ['task1_academic' => 150, 'task2' => 250];
const SEVERE_UNDERLENGTH_RATIO = 0.6;
const BAND1_MAX_WORDS = 20;
const COPY_MIN_RUN = 5;
const TASK2_WEIGHT = 2;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const APP_DIR = __DIR__;

if (!file_exists(dirname(__DIR__) . '/config.php')) {
    http_response_code(500);
    exit('config.php belum ada. Salin config.sample.php menjadi config.php lalu isi pengaturannya.');
}

function config(?string $key = null): mixed
{
    static $cfg = null;
    $cfg ??= require dirname(__DIR__) . '/config.php';
    if ($key === null) return $cfg;
    $value = $cfg;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) return null;
        $value = $value[$part];
    }
    return $value;
}

ini_set('display_errors', config('debug') ? '1' : '0');
error_reporting(E_ALL);
date_default_timezone_set('UTC'); // semua waktu di database UTC; tampilan dikonversi ke Asia/Jakarta

require APP_DIR . '/errors.php';
require APP_DIR . '/lib/db.php';
require APP_DIR . '/lib/auth.php';
require APP_DIR . '/lib/http.php';

function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function is_uuid(mixed $v): bool
{
    return is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) === 1;
}

/** Waktu sekarang (UTC) dalam format DATETIME(3). */
function now_utc(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
}

/** "2026-10-06 07:30:00.000" (UTC) -> ISO 8601 untuk JavaScript. */
function iso(?string $dbTime): ?string
{
    if ($dbTime === null) return null;
    return (new DateTimeImmutable($dbTime, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

/** Contoh: "6 Okt 2026 14.30" (Asia/Jakarta). */
function format_date(?string $dbTime): string
{
    if ($dbTime === null) return '';
    $months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    $d = (new DateTimeImmutable($dbTime, new DateTimeZone('UTC')))->setTimezone(new DateTimeZone(APP_TIMEZONE));
    return $d->format('j') . ' ' . $months[(int) $d->format('n') - 1] . ' ' . $d->format('Y H.i');
}

function band1(float|int $b): string
{
    return number_format((float) $b, 1, '.', '');
}

function e(mixed $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function json_decode_or_null(?string $s): mixed
{
    if ($s === null || $s === '') return null;
    return json_decode($s, true);
}

function json_enc(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/** Map fungsi ke empat kriteria (urutan task, cc, lr, gra). */
const CRITERIA = ['task', 'cc', 'lr', 'gra'];
const CRITERION_NAMES = [
    'task1_academic' => [
        'task' => 'Task Achievement',
        'cc' => 'Coherence & Cohesion',
        'lr' => 'Lexical Resource',
        'gra' => 'Grammatical Range & Accuracy',
    ],
    'task2' => [
        'task' => 'Task Response',
        'cc' => 'Coherence & Cohesion',
        'lr' => 'Lexical Resource',
        'gra' => 'Grammatical Range & Accuracy',
    ],
];

function map_criteria(callable $fn): array
{
    $out = [];
    foreach (CRITERIA as $k) $out[$k] = $fn($k);
    return $out;
}

/** Hilangkan batas waktu PHP sebisanya (InfinityFree mungkin mengabaikan). Menunggu cURL tidak dihitung di Linux. */
function allow_long_request(): void
{
    if (function_exists('set_time_limit')) @set_time_limit(180);
    @ignore_user_abort(true);
}
