<?php
declare(strict_types=1);

// Gambar soal di folder upload_dir. Path di database relatif (pemisah "/").

const IMAGE_MIME = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp'];

/** Jenis gambar dari magic bytes. null = bukan PNG/JPEG/WEBP. */
function detect_image_type(string $b): ?string
{
    if (strncmp($b, "\x89PNG\r\n\x1a\n", 8) === 0) return 'png';
    if (strncmp($b, "\xFF\xD8\xFF", 3) === 0) return 'jpg';
    if (strlen($b) >= 12 && substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP') return 'webp';
    return null;
}

function upload_root(): string
{
    $dir = (string) (config('upload_dir') ?: dirname(APP_DIR) . '/storage/uploads');
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    return rtrim(str_replace('\\', '/', realpath($dir) ?: $dir), '/');
}

/** Path absolut; menolak path yang keluar dari upload_dir. */
function upload_path(string $rel): string
{
    if (str_contains($rel, '..') || str_starts_with($rel, '/') || str_contains($rel, '\\')) {
        throw new RuntimeException('path di luar upload_dir');
    }
    return upload_root() . '/' . $rel;
}

function save_image(string $rel, string $data): string
{
    $abs = upload_path($rel);
    if (!is_dir(dirname($abs))) mkdir(dirname($abs), 0775, true);
    file_put_contents($abs, $data);
    return $rel;
}

function copy_image(string $fromRel, string $toBase): string
{
    $rel = $toBase . '.' . pathinfo($fromRel, PATHINFO_EXTENSION);
    $abs = upload_path($rel);
    if (!is_dir(dirname($abs))) mkdir(dirname($abs), 0775, true);
    copy(upload_path($fromRel), $abs);
    return $rel;
}

/** ['data' => bytes, 'mime' => ...] atau null kalau file hilang. */
function read_image(string $rel): ?array
{
    $abs = upload_path($rel);
    if (!is_file($abs)) return null;
    return ['data' => file_get_contents($abs), 'mime' => IMAGE_MIME[pathinfo($rel, PATHINFO_EXTENSION)] ?? 'application/octet-stream'];
}

function delete_image(string $rel): void
{
    $abs = upload_path($rel);
    if (is_file($abs)) @unlink($abs);
}

function send_image(?string $rel): never
{
    $img = $rel ? read_image($rel) : null;
    if (!$img) throw new AppError('NOT_FOUND');
    header('Content-Type: ' . $img['mime']);
    header('Cache-Control: private, no-store');
    header('Content-Length: ' . strlen($img['data']));
    echo $img['data'];
    exit;
}
