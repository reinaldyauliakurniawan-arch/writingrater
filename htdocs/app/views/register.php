<div class="auth stack">
    <h1 class="page-title">Daftar</h1>
    <form method="post" action="/register" class="card stack">
        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
        <div>
            <label class="label" for="name">Nama</label>
            <input id="name" name="name" required maxlength="100" class="input" value="<?= e($old['name'] ?? '') ?>" autocomplete="name">
        </div>
        <div>
            <label class="label" for="email">Email</label>
            <input id="email" name="email" type="email" required class="input" value="<?= e($old['email'] ?? '') ?>" autocomplete="email">
        </div>
        <div>
            <label class="label" for="password">Password</label>
            <input id="password" name="password" type="password" required minlength="8" maxlength="100" class="input" autocomplete="new-password">
        </div>
        <div>
            <label class="label" for="password2">Ulangi password</label>
            <input id="password2" name="password2" type="password" required class="input" autocomplete="new-password">
        </div>
        <?php if ($error): ?><div role="alert" class="banner-error"><?= e($error) ?></div><?php endif; ?>
        <button type="submit" class="btn-primary btn-block">Daftar</button>
    </form>
</div>
