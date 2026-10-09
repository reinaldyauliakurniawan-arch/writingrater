<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/scoring.php';
require_once APP_DIR . '/lib/corrections.php';
require_once APP_DIR . '/lib/storage.php';

// Akses data milik user (pengganti RLS: setiap query memakai id + userId) dan bentuk respons API.

function get_owned_submission(string $id, string $userId): array
{
    $s = db_one('SELECT s.*, q.name AS questionName FROM `submission` s LEFT JOIN `question` q ON q.id = s.questionId WHERE s.id = ? AND s.userId = ?', [$id, $userId]);
    if (!$s) throw new AppError('NOT_FOUND');
    return $s;
}

function get_owned_session(string $id, string $userId): array
{
    $s = db_one('SELECT * FROM `writingsession` WHERE id = ? AND userId = ?', [$id, $userId]);
    if (!$s) throw new AppError('NOT_FOUND');
    return $s;
}

function update_owned_submission(string $id, string $userId, array $data): void
{
    db_update('submission', $data, ['id' => $id, 'userId' => $userId]);
}

function get_polished(string $submissionId): ?array
{
    return db_one('SELECT * FROM `polishedversion` WHERE submissionId = ?', [$submissionId]);
}

function session_of(array $sub, string $userId): ?array
{
    return $sub['sessionId'] ? get_owned_session($sub['sessionId'], $userId) : null;
}

/**
 * Reset saat soal/gambar berubah: status kembali draft kalau extracted/confirmed,
 * dan tautan ke database soal dilepas.
 */
function reset_extraction_fields(array $sub): array
{
    $out = $sub['questionId'] ? ['questionId' => null] : [];
    if (in_array($sub['status'], ['extracted', 'confirmed'], true)) {
        $out += ['status' => 'draft', 'extractedData' => null, 'extractionUncertain' => null];
    }
    return $out;
}

function criteria_view(string $task, array $criteria): array
{
    return array_map(fn($k) => [
        'key' => $k,
        'name' => CRITERION_NAMES[$task][$k],
        'band' => $criteria[$k]['band'],
        'feedback' => $criteria[$k]['feedback'],
        'tip' => $criteria[$k]['tip'],
    ], CRITERIA);
}

function polish_target_of(array $sub): ?float
{
    $gr = json_decode_or_null($sub['gradeResult']);
    if ($sub['status'] !== 'graded' || $sub['taskBand'] === null || !$gr) return null;
    if (($gr['language_check'] ?? null) !== 'english' || (int) ($sub['wordCountCounted'] ?? 0) <= 20) return null;
    return polish_target((float) $sub['taskBand']);
}

function submission_result(array $sub, ?array $session): ?array
{
    $gr = json_decode_or_null($sub['gradeResult']);
    if ($sub['status'] !== 'graded' || !$gr || $sub['taskBand'] === null || $sub['taskBandRaw'] === null) return null;
    return [
        'id' => $sub['id'],
        'task_type' => $sub['taskType'],
        'status' => 'graded',
        'word_count' => [
            'total' => (int) $sub['wordCountTotal'],
            'excluded' => (int) $sub['wordCountExcluded'],
            'counted' => (int) $sub['wordCountCounted'],
            'min' => MIN_WORDS[$sub['taskType']],
        ],
        'criteria' => criteria_view($sub['taskType'], $gr['criteria']),
        'task_band' => (float) $sub['taskBand'],
        'task_band_raw' => (float) $sub['taskBandRaw'],
        'fact_errors' => $sub['taskType'] === 'task1_academic' ? ($gr['fact_check']['fact_errors'] ?? []) : null,
        'session' => $session ? ['id' => $session['id'], 'writing_band' => $session['writingBand'] !== null ? (float) $session['writingBand'] : null] : null,
        'polish_target' => polish_target_of($sub),
    ];
}

function polished_view(array $sub, array $p): array
{
    $essay = (string) ($sub['essayText'] ?? '');
    $facts = json_decode_or_null($sub['factErrors']) ?? [];
    $data = array_map(fn($f) => ['quote' => $f['essay_quote'], 'type' => 'data', 'issue' => $f['issue'], 'correction' => $f['correct_info']], $facts);
    $others = json_decode_or_null($p['corrections']) ?? [];
    // Data salah ditempatkan dulu: sudah dicek terhadap data grafik.
    $marks = locate_corrections($essay, array_merge($data, $others));
    $rescored = json_decode_or_null($p['rescoredResult']);
    $counts = array_fill_keys(['content', 'data', 'cohesion', 'vocab', 'grammar'], 0);
    foreach ($marks as $m) $counts[$m['type']]++;
    return [
        'target_band' => (float) $p['targetBand'],
        'task_type' => $sub['taskType'],
        'original_segments' => to_segments($essay, $marks),
        'mark_counts' => $counts,
        'mark_total' => count($marks),
        'has_corrections' => $p['corrections'] !== null,
        'polished_text' => $p['polishedText'],
        'rescored_task_band' => (float) $p['rescoredTaskBand'],
        'rescored_criteria' => criteria_view($sub['taskType'], $rescored['criteria']),
    ];
}

function submission_detail(array $sub, ?array $session): array
{
    $p = get_polished($sub['id']);
    return [
        'id' => $sub['id'],
        'task_type' => $sub['taskType'],
        'status' => $sub['status'],
        'session_id' => $sub['sessionId'],
        'student_name' => $sub['studentName'] ?? null,
        'prompt_text' => $sub['promptText'],
        'prompt_image_url' => $sub['promptImagePath'] ? '/api/submissions/' . $sub['id'] . '/image' : null,
        'extracted_data' => json_decode_or_null($sub['extractedData']),
        'extraction_uncertain' => json_decode_or_null($sub['extractionUncertain']),
        'essay_text' => (string) ($sub['essayText'] ?? ''),
        'last_error_code' => $sub['lastErrorCode'],
        'created_at' => iso($sub['createdAt']),
        'graded_at' => iso($sub['gradedAt']),
        'result' => submission_result($sub, $session),
        'polished' => $p ? polished_view($sub, $p) : null,
        'question' => $sub['questionId'] ? ['id' => $sub['questionId'], 'name' => $sub['questionName'] ?? ''] : null,
    ];
}

function submission_detail_by_id(string $id, string $userId): array
{
    $sub = get_owned_submission($id, $userId);
    return submission_detail($sub, session_of($sub, $userId));
}

/** { session, task1, task2 } untuk halaman sesi. */
function session_view(string $id, string $userId): array
{
    $session = get_owned_session($id, $userId);
    $subs = db_all('SELECT id, taskType FROM `submission` WHERE sessionId = ? AND userId = ?', [$id, $userId]);
    $detail = function (string $type) use ($subs, $userId) {
        foreach ($subs as $s) if ($s['taskType'] === $type) return submission_detail_by_id($s['id'], $userId);
        return null;
    };
    return [
        'session' => [
            'id' => $session['id'],
            'writing_band' => $session['writingBand'] !== null ? (float) $session['writingBand'] : null,
            'writing_band_raw' => $session['writingBandRaw'] !== null ? (float) $session['writingBandRaw'] : null,
            'created_at' => iso($session['createdAt']),
        ],
        'task1' => $detail('task1_academic'),
        'task2' => $detail('task2'),
    ];
}

/** Skor Writing hanya kalau Task 1 dan Task 2 di sesi sudah graded. */
function update_writing_band(string $sessionId, string $userId): void
{
    $subs = db_all("SELECT taskType, taskBandRaw FROM `submission` WHERE sessionId = ? AND userId = ? AND status = 'graded'", [$sessionId, $userId]);
    $raw = [];
    foreach ($subs as $s) if ($s['taskBandRaw'] !== null) $raw[$s['taskType']] = (float) $s['taskBandRaw'];
    if (!isset($raw['task1_academic'], $raw['task2'])) return;
    $w = writing_band($raw['task1_academic'], $raw['task2']);
    db_update('writingsession', ['writingBandRaw' => $w['raw'], 'writingBand' => $w['band']], ['id' => $sessionId, 'userId' => $userId]);
}

function create_submission(string $userId, string $taskType, ?string $sessionId): string
{
    $id = uuid();
    // Task kedua di sesi yang sama milik murid yang sama.
    $student = $sessionId ? db_one('SELECT studentName FROM `submission` WHERE sessionId = ? AND userId = ? AND studentName IS NOT NULL LIMIT 1', [$sessionId, $userId]) : null;
    db_insert('submission', [
        'id' => $id,
        'userId' => $userId,
        'sessionId' => $sessionId,
        'taskType' => $taskType,
        'status' => 'draft',
        'promptText' => '',
        'studentName' => $student['studentName'] ?? null,
        'createdAt' => now_utc(),
    ]);
    return $id;
}

/** Nama murid: spasi dirapikan, kosong = null. */
function normalize_student_name(?string $name): ?string
{
    $name = trim(preg_replace('/\s+/u', ' ', (string) $name));
    return $name === '' ? null : $name;
}

/** Nama murid yang pernah dipakai user ini (untuk saran isian dan filter riwayat). */
function student_names(string $userId): array
{
    return array_column(db_all('SELECT DISTINCT studentName FROM `submission` WHERE userId = ? AND studentName IS NOT NULL ORDER BY studentName', [$userId]), 'studentName');
}

function create_session(string $userId): string
{
    $id = uuid();
    db_insert('writingsession', ['id' => $id, 'userId' => $userId, 'createdAt' => now_utc()]);
    return $id;
}

function load_prompt_image(array $sub): ?array
{
    return $sub['promptImagePath'] ? read_image($sub['promptImagePath']) : null;
}
