<?php
/** @var string $content @var ?string $pageTitle */
$user = current_user();
$wide = !empty($vars['wide']);
$v = '?v=' . filemtime(dirname(APP_DIR) . '/assets/app.js') . filemtime(dirname(APP_DIR) . '/assets/app.css');
?><!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="<?= e(csrf_token()) ?>">
    <title><?= e($pageTitle ? "$pageTitle · " . APP_NAME : APP_NAME) ?></title>
    <meta name="description" content="Latihan menilai IELTS Writing Task 1 Academic dan Task 2 dengan AI.">
    <link rel="icon" href="/assets/logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css<?= $v ?>">
    <script src="/assets/app.js<?= $v ?>" defer></script>
</head>
<body>
<?php if ($pageTitle !== null): ?>
    <header class="site-header">
        <div class="header-inner<?= $wide ? ' container-wide' : '' ?>">
            <a href="<?= $user ? '/new' : '/' ?>" class="brand">
                <img src="/assets/logo.png" alt="Just Speak">
                <span><?= e(APP_NAME) ?></span>
            </a>
            <?php if ($user): ?>
                <nav class="nav">
                    <a href="/new">Baru</a>
                    <a href="/history">Riwayat</a>
                    <a href="/questions">Soal</a>
                    <?php if ($user['is_admin']): ?><a href="/settings">Pengaturan</a><?php endif; ?>
                    <form method="post" action="/logout">
                        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                        <button type="submit" class="nav-logout">Keluar</button>
                    </form>
                </nav>
            <?php endif; ?>
        </div>
    </header>
    <main class="container<?= $wide ? ' container-wide' : '' ?>"><?= $content ?></main>
<?php else: ?>
    <?= $content ?>
<?php endif; ?>
</body>
</html>
