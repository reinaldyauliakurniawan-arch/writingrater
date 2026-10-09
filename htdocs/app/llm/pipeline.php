<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/submissions.php';
require_once APP_DIR . '/llm/client.php';
require_once APP_DIR . '/llm/prompts.php';

// Alur AI (bagian 6) dipecah per tahap: setiap request menjalankan paling banyak satu tahap AI,
// lalu menyimpan progres di submission.pendingState. Browser memanggil lagi sampai selesai.

/** Hasil penilaian tanpa AI (<= 20 kata). */
function fixed_core(array $criteria, array $wc, array $flags): array
{
    $criteria = array_map(fn($c) => $c + ['evidence' => []], $criteria);
    $bands = bands_of($criteria);
    $tb = task_band($bands);
    return [
        'wordCount' => $wc,
        'gradeResult' => [
            'criteria' => $criteria,
            'raw_bands' => $bands,
            'ceilings_applied' => [],
            'language_check' => null,
            'fact_check' => null,
        ] + $flags,
        'bands' => $bands,
        'taskBand' => $tb['band'],
        'taskBandRaw' => $tb['raw'],
        'model' => null,
    ];
}

/** Tahap factcheck Task 1 (6.3). */
function run_factcheck(string $promptText, array $extractedData, string $essay, ?array $log): array
{
    return llm_structured([
        'name' => 'factcheck',
        'schema' => schema_fact_check(),
        'system' => FACTCHECK_SYSTEM,
        'content' => build_factcheck_content($promptText, $extractedData, $essay),
        'maxTokens' => 2000,
        'log' => $log ? $log + ['kind' => 'factcheck'] : null,
    ])['value'];
}

/** Tahap grade (6.4) + aturan keras + ceiling. Mengembalikan hasil inti penilaian. */
function run_grade(string $task, string $promptText, ?array $image, ?array $extractedData, ?array $factCheck, string $essay, array $wc, array $flags, ?array $log, string $kind, ?string $fixture = null): array
{
    $graded = llm_structured([
        'name' => 'grade',
        'schema' => schema_grade(),
        'system' => build_grade_system($task, $wc['counted'], $flags),
        'content' => build_grade_content($task, $promptText, $image, $extractedData, $factCheck, $essay),
        'maxTokens' => 4000,
        'log' => $log ? $log + ['kind' => $kind] : null,
        'validate' => 'check_grade_output',
        'fixture' => $fixture,
    ]);
    $out = $graded['value'];
    $post = apply_hard_rules($task, $wc['counted'], $out['language_check']);
    $ceilingsApplied = [];
    if ($post['kind'] === 'fixed') {
        $criteria = array_map(fn($c) => $c + ['evidence' => []], $post['criteria']);
        $rawBands = bands_of($criteria);
    } else {
        $rawBands = bands_of($out['criteria']);
        $capped = apply_ceilings($rawBands, $out['ceilings_triggered'], $task);
        $ceilingsApplied = $capped['applied'];
        $criteria = map_criteria(fn($k) => [
            'band' => $capped['bands'][$k],
            'feedback' => $out['criteria'][$k]['feedback'],
            'tip' => $out['criteria'][$k]['tip'],
            'evidence' => $out['criteria'][$k]['evidence'],
        ]);
    }
    $bands = bands_of($criteria);
    $tb = task_band($bands);
    return [
        'wordCount' => $wc,
        'gradeResult' => [
            'criteria' => $criteria,
            'raw_bands' => $rawBands,
            'ceilings_applied' => $ceilingsApplied,
            'language_check' => $out['language_check'],
            'fact_check' => $factCheck,
        ] + $flags,
        'bands' => $bands,
        'taskBand' => $tb['band'],
        'taskBandRaw' => $tb['raw'],
        'model' => $graded['model'],
    ];
}

function pending_state(array $sub, string $kind): ?array
{
    $s = json_decode_or_null($sub['pendingState'] ?? null);
    return is_array($s) && ($s['kind'] ?? null) === $kind ? $s : null;
}

/** Simpan error terakhir lalu lempar ulang (LLM gagal = LLM_FAILED). */
function record_failure(array $sub, string $userId, Throwable $e, array $extra = []): never
{
    $code = $e instanceof AppError ? $e->errorCode : 'LLM_FAILED';
    update_owned_submission($sub['id'], $userId, $extra + ['lastErrorCode' => $code]);
    if ($e instanceof AppError) throw $e;
    error_log((string) $e);
    throw new AppError('LLM_FAILED');
}

/**
 * Aksi grade, satu tahap per panggilan.
 * Hasil: ['done' => true, 'sub' => row] atau ['done' => false, 'message' => teks progres].
 */
function grade_step(array $sub, string $essay, string $userId): array
{
    $task = $sub['taskType'];
    $wc = count_words($essay, $sub['promptText']);
    $flags = length_flags($task, $wc['counted']);
    $essayFields = [
        'essayText' => $essay,
        'wordCountTotal' => $wc['total'],
        'wordCountExcluded' => $wc['excluded'],
        'wordCountCounted' => $wc['counted'],
    ];

    $pre = apply_hard_rules($task, $wc['counted']);
    if ($pre['kind'] === 'reject') {
        update_owned_submission($sub['id'], $userId, $essayFields);
        throw new AppError($pre['code']);
    }

    $hash = hash('sha256', $essay);
    $state = pending_state($sub, 'grade');
    if (!$state || $state['essay_hash'] !== $hash) $state = ['kind' => 'grade', 'essay_hash' => $hash, 'actionId' => uuid(), 'fact_check' => null];
    $log = ['userId' => $userId, 'submissionId' => $sub['id'], 'action' => 'grade', 'actionId' => $state['actionId']];
    $extracted = json_decode_or_null($sub['extractedData']);

    try {
        if ($pre['kind'] === 'fixed') {
            $core = fixed_core($pre['criteria'], $wc, $flags);
        } elseif ($task === 'task1_academic' && $state['fact_check'] === null) {
            if (!$extracted) throw new AppError('EXTRACTION_NOT_CONFIRMED');
            $state['fact_check'] = run_factcheck($sub['promptText'], $extracted, $essay, $log);
            update_owned_submission($sub['id'], $userId, $essayFields + ['pendingState' => json_enc($state), 'lastErrorCode' => null]);
            return ['done' => false, 'message' => 'Data sudah dicek, sekarang menilai jawaban…'];
        } else {
            $image = load_prompt_image($sub);
            $core = run_grade($task, $sub['promptText'], $image, $extracted, $state['fact_check'], $essay, $wc, $flags, $log, 'grade');
        }
    } catch (Throwable $e) {
        record_failure($sub, $userId, $e, $essayFields);
    }

    update_owned_submission($sub['id'], $userId, $essayFields + [
        'status' => 'graded',
        'factErrors' => isset($core['gradeResult']['fact_check']) ? json_enc($core['gradeResult']['fact_check']['fact_errors']) : null,
        'gradeResult' => json_enc($core['gradeResult']),
        'bandTask' => $core['bands']['task'],
        'bandCc' => $core['bands']['cc'],
        'bandLr' => $core['bands']['lr'],
        'bandGra' => $core['bands']['gra'],
        'taskBandRaw' => $core['taskBandRaw'],
        'taskBand' => $core['taskBand'],
        'model' => $core['model'],
        'promptVersion' => PROMPT_VERSION,
        'lastErrorCode' => null,
        'gradedAt' => now_utc(),
        'pendingState' => null,
    ]);
    if ($sub['sessionId']) update_writing_band($sub['sessionId'], $userId);
    return ['done' => true, 'sub' => get_owned_submission($sub['id'], $userId)];
}

/** Aksi extract (6.2): dua pembacaan paralel dalam satu request, bandingkan, simpan A. */
function extract_submission(array $sub, string $userId): array
{
    $image = $sub['promptImagePath'] ? read_image($sub['promptImagePath']) : null;
    if (!$image) throw new AppError('IMAGE_REQUIRED');
    $actionId = uuid();
    $call = fn(string $fixture) => [
        'name' => 'extract',
        'schema' => schema_extracted_data(),
        'system' => EXTRACT_SYSTEM,
        'content' => build_extract_content($image, $sub['promptText']),
        'maxTokens' => 4000,
        'log' => ['userId' => $userId, 'submissionId' => $sub['id'], 'action' => 'extract', 'actionId' => $actionId, 'kind' => 'extract'],
        'validate' => 'check_extracted_data',
        'fixture' => $fixture,
    ];
    try {
        [$a, $b] = llm_structured_many([$call('extract'), $call('extract-b')]);
    } catch (Throwable $e) {
        record_failure($sub, $userId, $e);
    }
    $uncertain = compare_extraction($a['value'], $b['value']);
    update_owned_submission($sub['id'], $userId, [
        'extractedData' => json_enc($a['value']),
        'extractionUncertain' => json_enc($uncertain),
        'status' => 'extracted',
        'lastErrorCode' => null,
    ]);
    return get_owned_submission($sub['id'], $userId);
}

/** Bentuk sama -> daftar sel berbeda; beda bentuk -> ['shape_mismatch' => true]. */
function compare_extraction(array $a, array $b): array
{
    $same = count($a['tables']) === count($b['tables']);
    if ($same) {
        foreach ($a['tables'] as $i => $ta) {
            $tb = $b['tables'][$i];
            $labelsA = array_column($ta['rows'], 'label');
            $labelsB = array_column($tb['rows'], 'label');
            if ($ta['columns'] !== $tb['columns'] || $labelsA !== $labelsB) $same = false;
        }
    }
    if (!$same) return ['shape_mismatch' => true];
    $cells = [];
    foreach ($a['tables'] as $i => $ta) {
        foreach ($ta['rows'] as $j => $ra) {
            foreach ($ra['values'] as $k => $va) {
                $vb = $b['tables'][$i]['rows'][$j]['values'][$k] ?? '';
                if ($va !== $vb) $cells[] = ['table' => $ta['name'], 'row' => $ra['label'], 'column' => $ta['columns'][$k], 'a' => $va, 'b' => $vb];
            }
        }
    }
    return $cells;
}

const POLISH_MAX_ATTEMPTS = 2;
const POLISH_TOLERANCE = 0.5;

/**
 * Aksi polish (6.5), satu tahap per panggilan: tulis ulang -> (Task 1: factcheck ulang) -> nilai ulang
 * -> kalau meleset > 0.5 dari target, satu percobaan lagi. Simpan versi paling dekat ke target.
 * Hasil: ['done' => true] atau ['done' => false, 'message' => ...].
 */
function polish_step(array $sub, string $userId): array
{
    $target = polish_target_of($sub);
    $previous = json_decode_or_null($sub['gradeResult']);
    if ($target === null || !$previous || !$sub['essayText']) throw new AppError('POLISH_NOT_AVAILABLE');

    $state = pending_state($sub, 'polish');
    if (!$state || (float) $state['target'] !== $target) {
        $state = ['kind' => 'polish', 'actionId' => uuid(), 'target' => $target, 'attempts' => [], 'current' => null];
    }
    $task = $sub['taskType'];
    $log = ['userId' => $userId, 'submissionId' => $sub['id'], 'action' => 'polish', 'actionId' => $state['actionId']];
    $extracted = json_decode_or_null($sub['extractedData']);
    $save = function () use (&$state, $sub, $userId): void {
        update_owned_submission($sub['id'], $userId, ['pendingState' => json_enc($state), 'lastErrorCode' => null]);
    };

    $finished = function () use (&$state, $target): bool {
        $n = count($state['attempts']);
        if ($n === 0 || $state['current'] !== null) return false;
        return $n >= POLISH_MAX_ATTEMPTS || abs($state['attempts'][$n - 1]['taskBand'] - $target) <= POLISH_TOLERANCE;
    };

    try {
        if (!$finished()) {
            $image = load_prompt_image($sub);
            if ($state['current'] === null) {
                $last = $state['attempts'] ? $state['attempts'][count($state['attempts']) - 1] : null;
                $previousGrade = map_criteria(fn($k) => [
                    'band' => $previous['criteria'][$k]['band'],
                    'feedback' => $previous['criteria'][$k]['feedback'],
                    'tip' => $previous['criteria'][$k]['tip'],
                ]);
                $polished = llm_structured([
                    'name' => 'polish',
                    'schema' => schema_polish(),
                    'system' => build_polish_system($task, $target),
                    'content' => build_polish_content(
                        $task, $sub['promptText'], $image, $extracted, $previous['fact_check'] ?? null, $sub['essayText'], $previousGrade,
                        $last ? ['previousRewrite' => $last['text'], 'rescored' => $last['taskBand'], 'target' => $target] : null,
                    ),
                    'maxTokens' => 5000,
                    'log' => $log + ['kind' => 'polish'],
                ])['value'];
                $state['current'] = [
                    'text' => trim($polished['polished_text']),
                    'corrections' => flatten_corrections($polished['corrections']),
                    'fact_check' => null,
                ];
                $save();
                return ['done' => false, 'message' => 'Versi polished sudah ditulis, sekarang dinilai ulang…'];
            }

            $text = $state['current']['text'];
            $wc = count_words($text, $sub['promptText']);
            $flags = length_flags($task, $wc['counted']);
            $pre = apply_hard_rules($task, $wc['counted']);
            if ($pre['kind'] === 'llm' && $task === 'task1_academic' && $state['current']['fact_check'] === null) {
                $state['current']['fact_check'] = run_factcheck($sub['promptText'], $extracted, $text, $log);
                $save();
                return ['done' => false, 'message' => 'Data versi polished sudah dicek, sekarang menilai ulang…'];
            }
            $rescore = $pre['kind'] === 'fixed'
                ? fixed_core($pre['criteria'], $wc, $flags)
                : run_grade($task, $sub['promptText'], $image, $extracted, $state['current']['fact_check'], $text, $wc, $flags, $log, 'rescore', 'rescore');
            $state['attempts'][] = [
                'text' => $text,
                'corrections' => $state['current']['corrections'],
                'taskBand' => $rescore['taskBand'],
                'rescoredResult' => $rescore['gradeResult'] + ['word_count' => $rescore['wordCount'], 'task_band_raw' => $rescore['taskBandRaw']],
            ];
            $state['current'] = null;
            if (!$finished()) {
                $save();
                return ['done' => false, 'message' => 'Skor belum pas dengan target, menulis ulang sekali lagi…'];
            }
        }
    } catch (Throwable $e) {
        record_failure($sub, $userId, $e);
    }

    // Paling dekat ke target; seri -> versi yang lebih baru.
    $best = $state['attempts'][0];
    foreach ($state['attempts'] as $a) {
        if (abs($a['taskBand'] - $target) <= abs($best['taskBand'] - $target)) $best = $a;
    }
    try {
        db_insert('polishedversion', [
            'id' => uuid(),
            'submissionId' => $sub['id'],
            'userId' => $userId,
            'targetBand' => $target,
            'polishedText' => $best['text'],
            'rescoredResult' => json_enc($best['rescoredResult']),
            'rescoredTaskBand' => $best['taskBand'],
            // Data salah Task 1 diambil dari fact_check saat ditampilkan, bukan dari daftar polish.
            'corrections' => json_enc($best['corrections']),
            'attempts' => count($state['attempts']),
            'createdAt' => now_utc(),
        ]);
    } catch (PDOException $e) {
        if (!is_duplicate_key($e)) throw $e; // request paralel sudah menyimpan versi polished
    }
    update_owned_submission($sub['id'], $userId, ['pendingState' => null, 'lastErrorCode' => null]);
    return ['done' => true];
}
