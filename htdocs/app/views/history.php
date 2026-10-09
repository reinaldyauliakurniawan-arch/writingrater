<?php $taskLabel = ['task1_academic' => 'Task 1 Academic', 'task2' => 'Task 2']; ?>
<h1 class="page-title" style="margin-bottom:16px">Riwayat</h1>

<section style="margin-bottom:32px">
    <h2 class="section-title">Sesi Writing lengkap</h2>
    <?php if (!$sessions): ?>
        <p class="muted">Belum ada sesi.</p>
    <?php else: ?>
        <ul class="stack-sm">
            <?php foreach ($sessions as $s): ?>
                <li>
                    <a href="/sessions/<?= e($s['id']) ?>" class="card-click list-item">
                        <span>
                            <span class="small muted" style="display:block"><?= e(format_date($s['createdAt'])) ?></span>
                            <span class="semibold">Sesi Writing lengkap</span>
                        </span>
                        <span class="score"><?= $s['writingBand'] !== null ? e(band1($s['writingBand'])) : 'Belum selesai' ?></span>
                    </a>
                </li>
            <?php endforeach; ?>
        </ul>
    <?php endif; ?>
</section>

<section>
    <h2 class="section-title">Submission</h2>
    <?php if (!$subs): ?>
        <p class="muted">Belum ada submission.</p>
    <?php else: ?>
        <ul class="stack-sm">
            <?php foreach ($subs as $s): ?>
                <li>
                    <a href="/submissions/<?= e($s['id']) ?>" class="card-click list-item">
                        <span class="grow">
                            <span class="small muted" style="display:block"><?= e(format_date($s['createdAt'])) ?></span>
                            <span class="semibold">
                                <?= e($taskLabel[$s['taskType']]) ?>
                                <?php if ($s['sessionId']): ?><span class="muted" style="font-weight:400"> · bagian dari sesi</span><?php endif; ?>
                            </span>
                            <?php if ($s['promptText'] !== ''): ?>
                                <span class="small muted truncate"><?= e(mb_substr($s['promptText'], 0, 120)) ?></span>
                            <?php endif; ?>
                        </span>
                        <span class="score"><?= $s['status'] === 'graded' && $s['taskBand'] !== null ? e(band1($s['taskBand'])) : 'Belum selesai' ?></span>
                    </a>
                </li>
            <?php endforeach; ?>
        </ul>
    <?php endif; ?>
</section>
