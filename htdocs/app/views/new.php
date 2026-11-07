<?php
$cards = [
    ['task1_academic', 'Task 1 Academic', 'Deskripsikan grafik, tabel, diagram, atau peta. Minimal 150 kata.'],
    ['task2', 'Task 2', 'Esai argumen atau opini. Minimal 250 kata.'],
    ['session', 'Sesi Writing lengkap', 'Task 1 + Task 2 dengan skor Writing gabungan.'],
];
?>
<div class="stack-lg">
    <h1 class="page-title">Mulai latihan</h1>
    <section class="stack-sm">
        <h2 class="section-title" style="margin:0">Writing</h2>
        <div class="choice-grid">
            <?php foreach ($cards as [$kind, $title, $desc]): ?>
                <form method="post" action="/new" data-once>
                    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                    <input type="hidden" name="kind" value="<?= e($kind) ?>">
                    <button type="submit" class="card-click choice">
                        <span class="choice-title"><?= e($title) ?></span>
                        <span class="choice-desc"><?= e($desc) ?></span>
                    </button>
                </form>
            <?php endforeach; ?>
        </div>
    </section>
    <section class="stack-sm">
        <h2 class="section-title" style="margin:0">Speaking</h2>
        <a href="/speaking" class="card-click choice">
            <span class="choice-title">Simulasi Speaking (Part 1–3)</span>
            <span class="choice-desc">Ujian bersama examiner. Rekaman diubah jadi teks di laptop; audio tidak disimpan.</span>
        </a>
    </section>
</div>
