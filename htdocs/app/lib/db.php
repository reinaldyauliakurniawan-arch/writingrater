<?php
declare(strict_types=1);

// Nama tabel huruf kecil supaya sama di Windows (Laragon) dan Linux (hosting).

function db(bool $reconnect = false): PDO
{
    static $pdo = null;
    if ($pdo && !$reconnect) return $pdo;
    $c = config('db');
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int) ($c['port'] ?? 3306), $c['name']);
    $pdo = new PDO($dsn, $c['user'], $c['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

/**
 * prepare + execute. Hosting memutus koneksi yang menganggur selama menunggu AI
 * ("MySQL server has gone away"): sambung ulang lalu coba sekali lagi.
 */
function db_run(string $sql, array $params): PDOStatement
{
    try {
        $st = db()->prepare($sql);
        $st->execute($params);
    } catch (PDOException $e) {
        if (!in_array($e->errorInfo[1] ?? null, [2006, 2013], true) && !str_contains($e->getMessage(), 'gone away')) throw $e;
        $st = db(true)->prepare($sql);
        $st->execute($params);
    }
    return $st;
}

function db_one(string $sql, array $params = []): ?array
{
    $row = db_run($sql, $params)->fetch();
    return $row === false ? null : $row;
}

function db_all(string $sql, array $params = []): array
{
    return db_run($sql, $params)->fetchAll();
}

function db_exec(string $sql, array $params = []): int
{
    return db_run($sql, $params)->rowCount();
}

/** INSERT dari array kolom => nilai. */
function db_insert(string $table, array $data): void
{
    $cols = array_keys($data);
    $sql = sprintf(
        'INSERT INTO `%s` (%s) VALUES (%s)',
        $table,
        implode(', ', array_map(fn($c) => "`$c`", $cols)),
        implode(', ', array_map(fn($c) => ":$c", $cols)),
    );
    db_exec($sql, array_combine(array_map(fn($c) => ":$c", $cols), array_values($data)));
}

/** UPDATE ... SET kolom = nilai WHERE (kondisi sederhana kolom = nilai, digabung AND). */
function db_update(string $table, array $data, array $where): int
{
    if (!$data) return 0;
    $params = [];
    $sets = [];
    foreach ($data as $c => $v) {
        $sets[] = "`$c` = :s_$c";
        $params[":s_$c"] = $v;
    }
    $conds = [];
    foreach ($where as $c => $v) {
        $conds[] = "`$c` = :w_$c";
        $params[":w_$c"] = $v;
    }
    return db_exec(sprintf('UPDATE `%s` SET %s WHERE %s', $table, implode(', ', $sets), implode(' AND ', $conds)), $params);
}

function is_duplicate_key(Throwable $e): bool
{
    return $e instanceof PDOException && ($e->errorInfo[1] ?? null) === 1062;
}

// ---- Upgrade skema: kolom yang ditambahkan setelah instalasi pertama ----

const SCHEMA_VERSION = 2;

/** Aman dijalankan berulang (dipakai /install dan ensure_schema). */
function upgrade_schema(): void
{
    $cols = array_column(db_all('SHOW COLUMNS FROM `submission`'), 'Field');
    if (!in_array('pendingState', $cols, true)) {
        db()->exec('ALTER TABLE `submission` ADD COLUMN `pendingState` longtext DEFAULT NULL');
    }
    if (!in_array('studentName', $cols, true)) {
        db()->exec('ALTER TABLE `submission` ADD COLUMN `studentName` varchar(100) DEFAULT NULL, ADD KEY `Submission_userId_studentName_idx` (`userId`, `studentName`)');
    }
}

/** Upgrade otomatis sekali per versi skema (penanda di upload_dir), jadi tidak perlu membuka /install setelah update. */
function ensure_schema(): void
{
    require_once APP_DIR . '/lib/storage.php';
    $marker = upload_root() . '/.schema-v' . SCHEMA_VERSION;
    if (is_file($marker)) return;
    try {
        upgrade_schema();
        @file_put_contents($marker, now_utc());
    } catch (Throwable $e) {
        error_log('upgrade skema: ' . $e->getMessage()); // tabel belum ada: /install yang membuatnya
    }
}
