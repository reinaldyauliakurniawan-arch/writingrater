<?php
declare(strict_types=1);

// Bagian 4: hitung kata, aturan keras, ceiling, pembulatan band. Semua deterministik (tanpa AI).

/** Bagian 4.1. Juga diterjemahkan ke JavaScript (assets/app.js -> countWords) untuk penghitung live. */
function count_words(string $essay, string $prompt): array
{
    $words = function (string $text): array {
        $out = [];
        foreach (preg_split('/\s+/u', $text) ?: [] as $t) {
            if ($t === '' || !preg_match('/[\p{L}\p{N}&%$£€]/u', $t)) continue;
            $out[] = mb_strtolower(preg_replace('/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/u', '', $t));
        }
        return $out;
    };
    $essayWords = $words($essay);
    $promptWords = $words($prompt);
    $total = count($essayWords);

    $excluded = 0;
    if (count($promptWords) >= COPY_MIN_RUN) {
        $grams = [];
        for ($i = 0; $i + COPY_MIN_RUN <= count($promptWords); $i++) {
            $grams[implode(' ', array_slice($promptWords, $i, COPY_MIN_RUN))] = true;
        }
        $copied = array_fill(0, $total, false);
        for ($i = 0; $i + COPY_MIN_RUN <= $total; $i++) {
            if (isset($grams[implode(' ', array_slice($essayWords, $i, COPY_MIN_RUN))])) {
                for ($j = $i; $j < $i + COPY_MIN_RUN; $j++) $copied[$j] = true;
            }
        }
        $excluded = count(array_filter($copied));
    }
    return ['total' => $total, 'excluded' => $excluded, 'counted' => $total - $excluded];
}

function length_flags(string $task, int $counted): array
{
    $min = MIN_WORDS[$task];
    return [
        'underlength' => $counted < $min,
        'severeUnderlength' => $counted < (int) floor($min * SEVERE_UNDERLENGTH_RATIO),
    ];
}

const BAND1_SHORT = 'Responses of 20 words or fewer are rated at Band 1. Write a complete response of at least {MIN} words so that every criterion can be assessed.';
const BAND0_NOT_ENGLISH = 'This response is not written in English, so it cannot be rated. Please submit your answer in English.';

/**
 * Bagian 4.2. Tanpa $languageCheck sebelum AI (baris 1–2), dengan $languageCheck sesudah AI (baris 3).
 * Hasil: ['kind' => 'reject'|'fixed'|'llm', ...].
 */
function apply_hard_rules(string $task, int $counted, ?string $languageCheck = null): array
{
    if ($counted === 0) return ['kind' => 'reject', 'code' => 'ESSAY_EMPTY'];
    $fixed = fn(int $band, string $fb) => map_criteria(fn() => ['band' => $band, 'feedback' => $fb, 'tip' => null]);
    if ($counted <= BAND1_MAX_WORDS) {
        return ['kind' => 'fixed', 'criteria' => $fixed(1, str_replace('{MIN}', (string) MIN_WORDS[$task], BAND1_SHORT))];
    }
    if ($languageCheck === 'not_english') {
        return ['kind' => 'fixed', 'criteria' => $fixed(0, BAND0_NOT_ENGLISH)];
    }
    return ['kind' => 'llm'];
}

function bands_of(array $criteria): array
{
    return map_criteria(fn($k) => (int) $criteria[$k]['band']);
}

function ceilings_all(): array
{
    static $c = null;
    $c ??= json_decode(file_get_contents(APP_DIR . '/kb/ceilings.json'), true, 512, JSON_THROW_ON_ERROR);
    return $c;
}

function ceilings_for(string $task): array
{
    return array_values(array_filter(ceilings_all(), fn($c) => in_array($task, $c['tasks'], true)));
}

/** Bagian 4.3. ['bands' => ..., 'applied' => [id...]] */
function apply_ceilings(array $bands, array $triggeredIds, string $task): array
{
    $applied = [];
    foreach ($triggeredIds as $id) {
        $c = null;
        foreach (ceilings_all() as $x) if ($x['id'] === $id) $c = $x;
        if (!$c || !in_array($task, $c['tasks'], true)) continue; // id tidak dikenal: diabaikan
        $bands[$c['criterion']] = min($bands[$c['criterion']], $c['cap']);
        if (!in_array($id, $applied, true)) $applied[] = $id;
    }
    return ['bands' => $bands, 'applied' => $applied];
}

function round_half(float $x): float
{
    $r = round($x * 10000) / 10000;
    $whole = floor($r);
    $frac = $r - $whole;
    if ($frac < 0.25) return $whole;
    if ($frac < 0.75) return $whole + 0.5;
    return $whole + 1;
}

/** ['raw' => rata-rata 4 kriteria, 'band' => dibulatkan ke 0.5]. */
function task_band(array $bands): array
{
    $raw = ($bands['task'] + $bands['cc'] + $bands['lr'] + $bands['gra']) / 4;
    return ['raw' => $raw, 'band' => round_half($raw)];
}

function writing_band(float $t1Raw, float $t2Raw): array
{
    $raw = ($t1Raw + TASK2_WEIGHT * $t2Raw) / (1 + TASK2_WEIGHT);
    return ['raw' => $raw, 'band' => round_half($raw)];
}

/** Target band polished. null = tombol polished tidak ditampilkan. */
function polish_target(float $taskBand): ?float
{
    if ($taskBand >= 9) return null;
    if ($taskBand < 7) return 7.0;
    return min(9.0, $taskBand + 1);
}

// ---- Knowledge base descriptor (bagian 5.2) ----

function descriptors(): array
{
    static $d = null;
    $d ??= json_decode(file_get_contents(APP_DIR . '/kb/descriptors.json'), true, 512, JSON_THROW_ON_ERROR);
    return $d;
}

function descriptor_block(string $task, string $k, array $bands): string
{
    $lines = ['### ' . CRITERION_NAMES[$task][$k]];
    foreach ($bands as $b) {
        $e = descriptors()['tasks'][$task][$k][(string) $b];
        $lines[] = "Band $b:";
        foreach ($e['positive'] as $s) $lines[] = "- $s";
        foreach ($e['negative'] as $s) $lines[] = "- [LIMITING] $s";
    }
    return implode("\n", $lines);
}

/** Descriptor band 9 ke 1 untuk keempat kriteria. */
function get_descriptors(string $task): string
{
    return implode("\n\n", map_criteria(fn($k) => descriptor_block($task, $k, [9, 8, 7, 6, 5, 4, 3, 2, 1])));
}

/** Descriptor satu band untuk keempat kriteria (prompt polish). */
function get_band_descriptors(string $task, int $band): string
{
    return implode("\n\n", map_criteria(fn($k) => descriptor_block($task, $k, [$band])));
}

function get_ceiling_lines(string $task): string
{
    return implode("\n", array_map(fn($c) => "{$c['id']}: {$c['rule']}", ceilings_for($task)));
}
