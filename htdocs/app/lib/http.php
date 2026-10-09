<?php
declare(strict_types=1);

final class JsonResponse
{
    public function __construct(public readonly mixed $data, public readonly int $status = 200)
    {
    }
}

function ok(mixed $data, int $status = 200): JsonResponse
{
    return new JsonResponse($data, $status);
}

function send_json(array $body, int $status): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

/** Body JSON request; rusak/kosong dianggap []. */
function request_json(): array
{
    static $body = null;
    if ($body !== null) return $body;
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    $body = is_array($decoded) ? $decoded : [];
    return $body;
}

/** Metode HTTP; browser mengirim POST + X-HTTP-Method-Override karena sebagian hosting memblokir PUT/PATCH/DELETE. */
function request_method(): string
{
    $m = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ($m === 'POST') {
        $o = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
        if (in_array($o, ['PUT', 'PATCH', 'DELETE'], true)) return $o;
    }
    return $m;
}

function redirect(string $to): never
{
    header('Location: ' . $to, true, 303);
    exit;
}

/** Render view di dalam layout. $vars tersedia sebagai variabel di view. */
function render(string $view, array $vars = [], ?string $title = null): never
{
    $content = (function (string $__view, array $__vars): string {
        extract($__vars, EXTR_SKIP);
        ob_start();
        require APP_DIR . "/views/$__view.php";
        return (string) ob_get_clean();
    })($view, $vars);
    $pageTitle = $title;
    require APP_DIR . '/views/layout.php';
    exit;
}

// ---- Validasi input sederhana (pengganti zod) ----

function input_str(array $src, string $key, int $max, bool $required = true, int $min = 0, bool $trim = true): ?string
{
    if (!array_key_exists($key, $src) || $src[$key] === null) {
        if ($required) throw new AppError('VALIDATION_ERROR');
        return null;
    }
    if (!is_string($src[$key])) throw new AppError('VALIDATION_ERROR');
    $v = $trim ? trim($src[$key]) : $src[$key];
    $len = mb_strlen($v);
    if ($len < $min || $len > $max) throw new AppError('VALIDATION_ERROR');
    return $v;
}

function input_enum(array $src, string $key, array $allowed, bool $required = true): ?string
{
    $v = $src[$key] ?? null;
    if ($v === null && !$required) return null;
    if (!is_string($v) || !in_array($v, $allowed, true)) throw new AppError('VALIDATION_ERROR');
    return $v;
}

function input_uuid(array $src, string $key, bool $required = true): ?string
{
    $v = $src[$key] ?? null;
    if ($v === null && !$required) return null;
    if (!is_uuid($v)) throw new AppError('VALIDATION_ERROR');
    return strtolower($v);
}
