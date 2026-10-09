<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/submissions.php';
require_once APP_DIR . '/lib/questions.php';
require_once APP_DIR . '/lib/settings.php';

// Halaman HTML. Form login/daftar/keluar/latihan baru memakai POST biasa + redirect.

function page_dispatch(string $path): never
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    try {
        if ($path === '/install') page_install($method);
        if ($method === 'POST') {
            check_csrf($_POST['csrf'] ?? null);
            match ($path) {
                '/login' => post_login(),
                '/register' => post_register(),
                '/logout' => post_logout(),
                '/new' => post_new(),
                default => throw new AppError('NOT_FOUND'),
            };
        }
        if (preg_match('#^/submissions/([0-9a-fA-F-]{36})$#', $path, $m)) page_submission(strtolower($m[1]));
        if (preg_match('#^/sessions/([0-9a-fA-F-]{36})$#', $path, $m)) page_session(strtolower($m[1]));
        match ($path) {
            '/' => page_landing(),
            '/login' => page_login(),
            '/register' => page_register(),
            '/new' => page_new(),
            '/history' => page_history(),
            '/questions' => page_questions(),
            '/settings' => page_settings(),
            default => throw new AppError('NOT_FOUND'),
        };
    } catch (AppError $e) {
        if ($e->errorCode === 'UNAUTHORIZED') redirect('/login');
        http_response_code($e->status());
        render('message', ['message' => $e->userMessage()], 'Kesalahan');
    } catch (Throwable $e) {
        error_log((string) $e);
        http_response_code(500);
        $msg = config('debug') ? $e->getMessage() : 'Terjadi kesalahan. Coba lagi.';
        render('message', ['message' => $msg], 'Kesalahan');
    }
}

function page_landing(): never
{
    if (current_user()) redirect('/new');
    render('landing', [], null);
}

function page_login(?string $error = null, string $email = ''): never
{
    if (current_user()) redirect('/new');
    render('login', ['error' => $error, 'email' => $email], 'Masuk');
}

function page_register(?string $error = null, array $old = []): never
{
    if (current_user()) redirect('/new');
    render('register', ['error' => $error, 'old' => $old], 'Daftar');
}

function post_login(): never
{
    $email = strtolower(trim((string) ($_POST['email'] ?? '')));
    $password = (string) ($_POST['password'] ?? '');
    $user = $email !== '' ? db_one('SELECT id, passwordHash FROM `user` WHERE email = ?', [$email]) : null;
    if (!$user || strlen($password) > 100 || !password_verify($password, $user['passwordHash'])) {
        http_response_code(401);
        page_login('Email atau password salah.', $email);
    }
    login_user($user['id']);
    redirect('/new');
}

function post_register(): never
{
    $name = trim((string) ($_POST['name'] ?? ''));
    $email = strtolower(trim((string) ($_POST['email'] ?? '')));
    $password = (string) ($_POST['password'] ?? '');
    $password2 = (string) ($_POST['password2'] ?? '');
    $old = ['name' => $name, 'email' => $email];
    if ($name === '' || mb_strlen($name) > 100) page_register('Isi nama (maksimal 100 karakter).', $old);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) page_register('Email tidak valid.', $old);
    if (strlen($password) < 8 || strlen($password) > 100) page_register('Password minimal 8 karakter.', $old);
    if ($password !== $password2) page_register('Ulangi password harus sama dengan password.', $old);
    if (db_one('SELECT id FROM `user` WHERE email = ?', [$email])) page_register(ERRORS['EMAIL_TAKEN'][1], $old);
    $id = uuid();
    try {
        db_insert('user', [
            'id' => $id,
            'email' => $email,
            'name' => $name,
            'passwordHash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]),
            'createdAt' => now_utc(),
        ]);
    } catch (PDOException $e) {
        if (is_duplicate_key($e)) page_register(ERRORS['EMAIL_TAKEN'][1], $old);
        throw $e;
    }
    login_user($id);
    redirect('/new');
}

function post_logout(): never
{
    logout_user();
    redirect('/');
}

function page_new(): never
{
    require_user();
    render('new', [], 'Mulai latihan');
}

function post_new(): never
{
    $user = require_user();
    $kind = $_POST['kind'] ?? '';
    if ($kind === 'session') {
        $sid = create_session($user['id']);
        create_submission($user['id'], 'task1_academic', $sid); // sesi dimulai dari Task 1
        redirect("/sessions/$sid");
    }
    if (!in_array($kind, ['task1_academic', 'task2'], true)) throw new AppError('VALIDATION_ERROR');
    redirect('/submissions/' . create_submission($user['id'], $kind, null));
}

function page_history(): never
{
    $user = require_user();
    $subs = db_all('SELECT id, taskType, status, taskBand, sessionId, promptText, createdAt FROM `submission` WHERE userId = ? ORDER BY createdAt DESC LIMIT 100', [$user['id']]);
    $sessions = db_all('SELECT id, writingBand, createdAt FROM `writingsession` WHERE userId = ? ORDER BY createdAt DESC LIMIT 100', [$user['id']]);
    render('history', ['subs' => $subs, 'sessions' => $sessions], 'Riwayat');
}

function page_questions(): never
{
    $user = require_user();
    render('questions', ['questions' => list_questions($user), 'user' => $user], 'Database soal');
}

function page_settings(): never
{
    $user = require_user();
    if (!$user['is_admin']) render('message', ['message' => 'Halaman ini khusus admin.'], 'Pengaturan');
    render('settings', ['settings' => public_settings(), 'providers' => PROVIDER_OPTIONS], 'Pengaturan');
}

function page_submission(string $id): never
{
    $user = require_user();
    render('submission', ['detail' => submission_detail_by_id($id, $user['id'])], 'Latihan');
}

function page_session(string $id): never
{
    $user = require_user();
    render('session', ['view' => session_view($id, $user['id'])], 'Sesi Writing');
}

// ---- Instalasi: buat/perbarui tabel dan impor soal bawaan ----

function install_status(): array
{
    $status = ['db_ok' => false, 'db_error' => null, 'tables' => false, 'users' => 0, 'questions' => 0, 'needs_upgrade' => false];
    try {
        db();
        $status['db_ok'] = true;
        $tables = array_map('strtolower', db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        $status['tables'] = in_array('submission', $tables, true) && in_array('question', $tables, true);
        if ($status['tables']) {
            $status['users'] = (int) db_one('SELECT COUNT(*) AS n FROM `user`')['n'];
            $status['questions'] = (int) db_one('SELECT COUNT(*) AS n FROM `question`')['n'];
            $status['needs_upgrade'] = !db_one("SHOW COLUMNS FROM `submission` LIKE 'pendingState'");
        }
    } catch (Throwable $e) {
        $status['db_error'] = $e->getMessage();
    }
    return $status;
}

function page_install(string $method): never
{
    $status = install_status();
    $user = $status['tables'] ? current_user() : null;
    // Boleh dijalankan siapa saja selama belum ada user; setelah itu hanya admin.
    $allowed = !$status['tables'] || $status['users'] === 0 || ($user && $user['is_admin']);
    $result = null;
    if ($method === 'POST') {
        check_csrf($_POST['csrf'] ?? null);
        if (!$allowed) throw new AppError('FORBIDDEN');
        $sql = file_get_contents(APP_DIR . '/schema.sql');
        $sql = preg_replace('/^--.*$/m', '', $sql);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) db()->exec($stmt);
        if (!db_one("SHOW COLUMNS FROM `submission` LIKE 'pendingState'")) {
            db()->exec('ALTER TABLE `submission` ADD COLUMN `pendingState` longtext DEFAULT NULL');
        }
        $adminId = null;
        foreach ((array) config('admin_emails') as $email) {
            $row = db_one('SELECT id FROM `user` WHERE email = ?', [strtolower(trim($email))]);
            if ($row) {
                $adminId = $row['id'];
                break;
            }
        }
        $result = seed_questions($adminId);
        $status = install_status();
    }
    render('install', ['status' => $status, 'allowed' => $allowed, 'result' => $result], 'Instalasi');
}
