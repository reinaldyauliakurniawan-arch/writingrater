<h1 class="page-title" style="margin-bottom:16px">Instalasi</h1>
<div class="stack">
    <div class="card stack-sm">
        <p class="semibold">Status</p>
        <?php if (!$status['db_ok']): ?>
            <div class="banner-error">Tidak bisa terhubung ke database. Periksa bagian <code>db</code> di config.php.<br><span class="small"><?= e($status['db_error']) ?></span></div>
        <?php else: ?>
            <ul class="small muted stack-sm">
                <li>Koneksi database: <span class="semibold" style="color:var(--ink)">berhasil</span></li>
                <li>Tabel: <span class="semibold" style="color:var(--ink)"><?= $status['tables'] ? ($status['needs_upgrade'] ? 'ada, perlu diperbarui' : 'lengkap') : 'belum dibuat' ?></span></li>
                <?php if ($status['tables']): ?>
                    <li>Pengguna terdaftar: <span class="semibold" style="color:var(--ink)"><?= (int) $status['users'] ?></span></li>
                    <li>Soal di database soal: <span class="semibold" style="color:var(--ink)"><?= (int) $status['questions'] ?></span></li>
                <?php endif; ?>
            </ul>
        <?php endif; ?>
    </div>

    <?php if ($result !== null): ?>
        <p class="notice">Instalasi selesai. <?= (int) $result ?> soal bawaan baru diimpor.</p>
    <?php endif; ?>

    <?php if ($status['db_ok']): ?>
        <?php if ($allowed): ?>
            <form method="post" action="/install" class="card stack" data-once>
                <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                <p>Tombol ini membuat tabel yang belum ada, memperbarui tabel lama, dan mengimpor 40 soal Cambridge 15–19 (soal yang sudah ada dilewati). Aman dijalankan berkali-kali; data yang ada tidak dihapus.</p>
                <button type="submit" class="btn-primary">Pasang / perbarui database</button>
            </form>
        <?php else: ?>
            <p class="card">Sudah ada pengguna terdaftar. Masuk dengan akun admin untuk menjalankan instalasi lagi.</p>
        <?php endif; ?>
    <?php endif; ?>

    <?php if ($status['tables'] && !$status['needs_upgrade']): ?>
        <p><a href="/" class="semibold text-primary">Buka aplikasi</a></p>
    <?php endif; ?>
</div>
