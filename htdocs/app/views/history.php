<?php
require_once __DIR__ . '/_data.php';
$taskLabel = ['task1_academic' => 'Task 1 Academic', 'task2' => 'Task 2'];
$bandOf = fn(?array $s) => $s && $s['status'] === 'graded' && $s['taskBand'] !== null ? band1($s['taskBand']) : null;
?>
<div class="row" style="justify-content:space-between;margin-bottom:16px">
    <h1 class="page-title">Riwayat</h1>
    <?php if ($students): ?>
        <form method="get" action="/history" class="row-sm">
            <label for="murid" class="small semibold">Murid</label>
            <select id="murid" name="murid" class="input" style="width:auto;min-width:200px" onchange="this.form.submit()">
                <option value="">Semua murid</option>
                <?php foreach ($students as $name): ?>
                    <option value="<?= e($name) ?>"<?= $name === $student ? ' selected' : '' ?>><?= e($name) ?></option>
                <?php endforeach; ?>
            </select>
            <noscript><button type="submit" class="btn-secondary">Tampilkan</button></noscript>
        </form>
    <?php endif; ?>
</div>

<?php if (count($points) >= 2): ?>
    <section class="card" style="margin-bottom:24px">
        <h2 class="section-title" style="margin-bottom:4px">Progres skor<?= $student !== null ? ' · ' . e($student) : '' ?></h2>
        <p class="small muted">Skor per task dari waktu ke waktu (<?= count($points) ?> penilaian terakhir).</p>
        <?= page_data('history', ['points' => $points]) ?>
    </section>
<?php endif; ?>

<?php if (!$items): ?>
    <p class="muted"><?= $student !== null ? 'Belum ada tulisan untuk murid ini.' : 'Belum ada latihan. Mulai dari menu Baru.' ?></p>
<?php else: ?>
    <ul class="stack-sm">
        <?php foreach ($items as $it): ?>
            <li>
                <?php if ($it['kind'] === 'session'): ?>
                    <a href="/sessions/<?= e($it['id']) ?>" class="card-click list-item">
                        <span class="grow">
                            <span class="small muted" style="display:block"><?= e(format_date($it['createdAt'])) ?><?= $it['studentName'] !== null ? ' · ' : '' ?><?php if ($it['studentName'] !== null): ?><span class="semibold text-ink"><?= e($it['studentName']) ?></span><?php endif; ?></span>
                            <span class="semibold">Sesi lengkap (Task 1 + Task 2)</span>
                            <span class="small muted" style="display:block">
                                Task 1: <?= e($bandOf($it['parts']['task1_academic'] ?? null) ?? '–') ?> · Task 2: <?= e($bandOf($it['parts']['task2'] ?? null) ?? '–') ?>
                            </span>
                        </span>
                        <span class="score"><?= $it['writingBand'] !== null ? e(band1($it['writingBand'])) : '<span class="pending">Belum selesai</span>' ?></span>
                    </a>
                <?php else: $s = $it['sub']; ?>
                    <a href="/submissions/<?= e($s['id']) ?>" class="card-click list-item">
                        <span class="grow">
                            <span class="small muted" style="display:block"><?= e(format_date($s['createdAt'])) ?><?= $s['studentName'] !== null ? ' · ' : '' ?><?php if ($s['studentName'] !== null): ?><span class="semibold text-ink"><?= e($s['studentName']) ?></span><?php endif; ?></span>
                            <span class="semibold"><?= e($taskLabel[$s['taskType']]) ?></span>
                            <?php if ($s['promptText'] !== ''): ?>
                                <span class="small muted truncate"><?= e(mb_substr($s['promptText'], 0, 140)) ?></span>
                            <?php endif; ?>
                        </span>
                        <span class="score"><?= $bandOf($s) !== null ? e($bandOf($s)) : '<span class="pending">Belum selesai</span>' ?></span>
                    </a>
                <?php endif; ?>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
