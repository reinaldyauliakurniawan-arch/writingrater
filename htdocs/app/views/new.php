<?php
$cards = [
    ['task1_academic', 'Task 1 Academic', 'Deskripsikan grafik, tabel, diagram, atau peta. Minimal 150 kata.'],
    ['task2', 'Task 2', 'Esai argumen atau opini. Minimal 250 kata.'],
    ['session', 'Sesi Writing lengkap (Task 1 + Task 2)', 'Kerjakan kedua task dan dapatkan skor Writing gabungan.'],
];
?>
<h1 class="page-title" style="margin-bottom:16px">Mulai latihan</h1>
<div class="stack">
    <?php foreach ($cards as [$kind, $title, $desc]): ?>
        <form method="post" action="/new" data-once>
            <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
            <input type="hidden" name="kind" value="<?= e($kind) ?>">
            <button type="submit" class="card-click">
                <span class="bold text-primary" style="display:block;font-size:18px"><?= e($title) ?></span>
                <span class="muted" style="display:block;margin-top:4px"><?= e($desc) ?></span>
            </button>
        </form>
    <?php endforeach; ?>
</div>
