<div class="auth stack">
    <h1 class="page-title">Masuk</h1>
    <form method="post" action="/login" class="card stack">
        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
        <div>
            <label class="label" for="email">Email</label>
            <input id="email" name="email" type="email" required class="input" value="<?= e($email) ?>" autocomplete="email">
        </div>
        <div>
            <label class="label" for="password">Password</label>
            <input id="password" name="password" type="password" required class="input" autocomplete="current-password">
        </div>
        <?php if ($error): ?><div role="alert" class="banner-error"><?= e($error) ?></div><?php endif; ?>
        <button type="submit" class="btn-primary btn-block">Masuk</button>
        <p class="small" style="text-align:center">
            <a href="/register" class="semibold text-primary">Belum punya akun? Daftar</a>
        </p>
    </form>
</div>
