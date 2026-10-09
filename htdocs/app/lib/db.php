<?php
declare(strict_types=1);

// Nama tabel huruf kecil supaya sama di Windows (Laragon) dan Linux (hosting).

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
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

function db_one(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

function db_all(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

function db_exec(string $sql, array $params = []): int
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
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
