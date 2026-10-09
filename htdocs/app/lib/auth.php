<?php
declare(strict_types=1);

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('iwr_session');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 30));
    session_start();
}

/** Lepas kunci file sesi supaya request lain dari user yang sama tidak menunggu (panggilan AI lama). */
function release_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
}

function is_admin_email(?string $email): bool
{
    if (!$email) return false;
    $admins = array_map(fn($e) => strtolower(trim($e)), (array) config('admin_emails'));
    return in_array(strtolower($email), $admins, true);
}

/** ['id','email','name','is_admin'] atau null. */
function current_user(): ?array
{
    static $user = false;
    if ($user !== false) return $user;
    $id = $_SESSION['uid'] ?? null;
    $user = null;
    if (is_string($id)) {
        try {
            $row = db_one('SELECT id, email, name FROM `user` WHERE id = ?', [$id]);
        } catch (PDOException) {
            return $user = null; // database belum siap (mis. halaman instalasi)
        }
        if ($row) $user = $row + ['is_admin' => is_admin_email($row['email'])];
    }
    return $user;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) throw new AppError('UNAUTHORIZED');
    return $u;
}

function require_admin(): array
{
    $u = require_user();
    if (!$u['is_admin']) throw new AppError('FORBIDDEN');
    return $u;
}

function login_user(string $userId): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = $userId;
}

function logout_user(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function check_csrf(?string $token): void
{
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) throw new AppError('CSRF');
}
