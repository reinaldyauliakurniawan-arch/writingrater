<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/submissions.php';
require_once APP_DIR . '/lib/questions.php';
require_once APP_DIR . '/lib/settings.php';

// API JSON untuk browser. Format: { data } atau { error: { code, message } }.

const UUID_RE = '([0-9a-fA-F-]{36})';

function api_routes(): array
{
    return [
        ['POST', '#^/api/submissions$#', 'api_create_submission'],
        ['GET', '#^/api/submissions/' . UUID_RE . '$#', 'api_get_submission'],
        ['PATCH', '#^/api/submissions/' . UUID_RE . '$#', 'api_patch_submission'],
        ['GET', '#^/api/submissions/' . UUID_RE . '/image$#', 'api_get_submission_image'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/image$#', 'api_upload_image'],
        ['DELETE', '#^/api/submissions/' . UUID_RE . '/image$#', 'api_delete_image'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/extract$#', 'api_extract'],
        ['PUT', '#^/api/submissions/' . UUID_RE . '/extracted-data$#', 'api_put_extracted_data'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/grade$#', 'api_grade'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/polish$#', 'api_polish'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/revise$#', 'api_revise'],
        ['POST', '#^/api/submissions/' . UUID_RE . '/use-question$#', 'api_use_question'],
        ['POST', '#^/api/sessions$#', 'api_create_session'],
        ['GET', '#^/api/sessions/' . UUID_RE . '$#', 'api_get_session'],
        ['GET', '#^/api/questions$#', 'api_list_questions'],
        ['POST', '#^/api/questions$#', 'api_create_question'],
        ['GET', '#^/api/questions/' . UUID_RE . '$#', 'api_get_question'],
        ['PATCH', '#^/api/questions/' . UUID_RE . '$#', 'api_patch_question'],
        ['DELETE', '#^/api/questions/' . UUID_RE . '$#', 'api_delete_question'],
        ['GET', '#^/api/questions/' . UUID_RE . '/image$#', 'api_get_question_image'],
        ['POST', '#^/api/speaking$#', 'api_create_speaking'],
        ['GET', '#^/api/speaking/' . UUID_RE . '$#', 'api_get_speaking'],
        ['PUT', '#^/api/speaking/' . UUID_RE . '/transcript$#', 'api_put_speaking_transcript'],
        ['POST', '#^/api/speaking/' . UUID_RE . '/assess$#', 'api_assess_speaking'],
        ['POST', '#^/api/speaking/' . UUID_RE . '/finalize$#', 'api_finalize_speaking'],
        ['POST', '#^/api/speaking/' . UUID_RE . '/reopen$#', 'api_reopen_speaking'],
        ['POST', '#^/api/settings/test$#', 'api_test_settings'],
        ['POST', '#^/api/settings/models$#', 'api_list_models'],
    ];
}

function api_dispatch(string $path): never
{
    $method = request_method();
    try {
        $found = false;
        foreach (api_routes() as [$m, $re, $fn]) {
            if (!preg_match($re, $path, $match)) continue;
            $found = true;
            if ($m !== $method) continue;
            if ($method !== 'GET') check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null);
            $res = $fn(...array_map('strtolower', array_slice($match, 1)));
            send_json(['data' => $res->data], $res->status);
        }
        throw new AppError($found ? 'VALIDATION_ERROR' : 'NOT_FOUND');
    } catch (AppError $e) {
        send_json(['error' => ['code' => $e->errorCode, 'message' => $e->userMessage()]], $e->status());
    } catch (Throwable $e) {
        error_log((string) $e);
        $msg = config('debug') ? $e->getMessage() : 'Terjadi kesalahan. Coba lagi.';
        send_json(['error' => ['code' => 'INTERNAL_ERROR', 'message' => $msg]], 500);
    }
}

// ---- Submission ----

function api_create_submission(): JsonResponse
{
    $user = require_user();
    $body = request_json();
    $task = input_enum($body, 'task_type', ['task1_academic', 'task2']);
    $sessionId = input_uuid($body, 'session_id', false);
    if ($sessionId) {
        get_owned_session($sessionId, $user['id']);
        if (db_one('SELECT id FROM `submission` WHERE sessionId = ? AND userId = ? AND taskType = ?', [$sessionId, $user['id'], $task])) {
            throw new AppError('SESSION_SLOT_TAKEN');
        }
    }
    try {
        return ok(['id' => create_submission($user['id'], $task, $sessionId)], 201);
    } catch (PDOException $e) {
        if (is_duplicate_key($e)) throw new AppError('SESSION_SLOT_TAKEN');
        throw $e;
    }
}

function api_get_submission(string $id): JsonResponse
{
    $user = require_user();
    return ok(submission_detail_by_id($id, $user['id']));
}

function api_patch_submission(string $id): JsonResponse
{
    $user = require_user();
    $body = request_json();
    $prompt = input_str($body, 'prompt_text', 5000, false, 0, false);
    $essay = input_str($body, 'essay_text', 10000, false, 0, false);
    $student = input_str($body, 'student_name', 100, false);
    $sub = get_owned_submission($id, $user['id']);
    $data = [];
    // Nama murid boleh diubah kapan saja (juga setelah dinilai); soal dan jawaban tidak.
    if ($student !== null) $data['studentName'] = normalize_student_name($student);
    if ($prompt === null && $essay === null) {
        update_owned_submission($id, $user['id'], $data);
        return ok(submission_detail_by_id($id, $user['id']));
    }
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    if ($prompt !== null) $data['promptText'] = $prompt;
    if ($essay !== null) $data['essayText'] = $essay;
    if ($prompt !== null && $prompt !== $sub['promptText']) $data += reset_extraction_fields($sub);
    update_owned_submission($id, $user['id'], $data);
    return ok(submission_detail_by_id($id, $user['id']));
}

function api_get_submission_image(string $id): never
{
    $user = require_user();
    release_session();
    send_image(get_owned_submission($id, $user['id'])['promptImagePath']);
}

function api_upload_image(string $id): JsonResponse
{
    $user = require_user();
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK || $f['size'] <= 0 || $f['size'] > MAX_IMAGE_BYTES) {
        throw new AppError('INVALID_IMAGE');
    }
    $data = file_get_contents($f['tmp_name']);
    $ext = detect_image_type($data);
    if (!$ext) throw new AppError('INVALID_IMAGE');
    $rel = save_image("{$user['id']}/{$sub['id']}.$ext", $data);
    if ($sub['promptImagePath'] && $sub['promptImagePath'] !== $rel) delete_image($sub['promptImagePath']);
    update_owned_submission($id, $user['id'], ['promptImagePath' => $rel] + reset_extraction_fields($sub));
    return ok(['prompt_image_url' => "/api/submissions/$id/image"]);
}

function api_delete_image(string $id): JsonResponse
{
    $user = require_user();
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    if ($sub['promptImagePath']) delete_image($sub['promptImagePath']);
    update_owned_submission($id, $user['id'], ['promptImagePath' => null] + reset_extraction_fields($sub));
    return ok([]);
}

function api_extract(string $id): JsonResponse
{
    require_once APP_DIR . '/llm/pipeline.php';
    $user = require_user();
    release_session();
    allow_long_request();
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['taskType'] !== 'task1_academic') throw new AppError('WRONG_TASK_TYPE');
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    if (!$sub['promptImagePath']) throw new AppError('IMAGE_REQUIRED');
    if (!in_array($sub['status'], ['draft', 'extracted'], true)) throw new AppError('VALIDATION_ERROR');
    $updated = extract_submission($sub, $user['id']);
    return ok([
        'extracted_data' => json_decode_or_null($updated['extractedData']),
        'extraction_uncertain' => json_decode_or_null($updated['extractionUncertain']),
    ]);
}

function api_put_extracted_data(string $id): JsonResponse
{
    $user = require_user();
    $data = parse_extracted_data(request_json()['extracted_data'] ?? null);
    if ($data === null) throw new AppError('VALIDATION_ERROR');
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    if ($sub['taskType'] !== 'task1_academic') throw new AppError('WRONG_TASK_TYPE');
    // draft = isi data manual tanpa membaca gambar (mis. model AI teks saja).
    if ($sub['status'] === 'draft' && trim($sub['promptText']) === '' && !$sub['promptImagePath']) throw new AppError('PROMPT_REQUIRED');
    update_owned_submission($id, $user['id'], ['extractedData' => json_enc($data), 'status' => 'confirmed']);
    return ok(['extracted_data' => $data]);
}

/** Satu tahap penilaian per request. { pending: true, message } atau { pending: false, result }. */
function api_grade(string $id): JsonResponse
{
    require_once APP_DIR . '/llm/pipeline.php';
    $user = require_user();
    release_session();
    allow_long_request();
    $essay = input_str(request_json(), 'essay_text', 10000, true, 0, false);
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    if ($sub['taskType'] === 'task1_academic' && $sub['status'] !== 'confirmed') throw new AppError('EXTRACTION_NOT_CONFIRMED');
    if ($sub['taskType'] === 'task2' && $sub['status'] !== 'draft') throw new AppError('VALIDATION_ERROR');
    if (trim($sub['promptText']) === '' && !$sub['promptImagePath']) throw new AppError('PROMPT_REQUIRED');
    $step = grade_step($sub, $essay, $user['id']);
    if (!$step['done']) return ok(['pending' => true, 'message' => $step['message']]);
    return ok(['pending' => false, 'result' => submission_result($step['sub'], session_of($step['sub'], $user['id']))]);
}

/** Satu tahap polish per request. { pending: true, message } atau { pending: false, polished }. */
function api_polish(string $id): JsonResponse
{
    require_once APP_DIR . '/llm/pipeline.php';
    $user = require_user();
    release_session();
    allow_long_request();
    $sub = get_owned_submission($id, $user['id']);
    if (polish_target_of($sub) === null) throw new AppError('POLISH_NOT_AVAILABLE');
    $p = get_polished($id);
    if (!$p) {
        $step = polish_step($sub, $user['id']);
        if (!$step['done']) return ok(['pending' => true, 'message' => $step['message']]);
        $p = get_polished($id);
    }
    return ok(['pending' => false, 'polished' => polished_view(get_owned_submission($id, $user['id']), $p)]);
}

/** Submission baru tanpa sesi dengan soal + esai yang disalin ("Revisi & nilai ulang"). */
function api_revise(string $id): JsonResponse
{
    $user = require_user();
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] !== 'graded') throw new AppError('VALIDATION_ERROR');
    $newId = uuid();
    $image = $sub['promptImagePath'] ? copy_image($sub['promptImagePath'], "{$user['id']}/$newId") : null;
    db_insert('submission', [
        'id' => $newId,
        'userId' => $user['id'],
        'sessionId' => null,
        'taskType' => $sub['taskType'],
        'status' => $sub['taskType'] === 'task1_academic' && $sub['extractedData'] ? 'confirmed' : 'draft',
        'promptText' => $sub['promptText'],
        'promptImagePath' => $image,
        'extractedData' => $sub['extractedData'],
        'essayText' => $sub['essayText'],
        'questionId' => $sub['questionId'],
        'studentName' => $sub['studentName'],
        'createdAt' => now_utc(),
    ]);
    return ok(['id' => $newId], 201);
}

/** Isi soal dari database soal. Task 1 langsung "confirmed" (data grafik sudah dicek). */
function api_use_question(string $id): JsonResponse
{
    $user = require_user();
    $qid = input_uuid(request_json(), 'question_id');
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    $q = get_question($qid);
    if ($q['taskType'] !== $sub['taskType']) throw new AppError('VALIDATION_ERROR');
    $image = $q['imagePath'] ? copy_image($q['imagePath'], "{$user['id']}/{$sub['id']}") : null;
    if ($sub['promptImagePath'] && $sub['promptImagePath'] !== $image) delete_image($sub['promptImagePath']);
    $hasData = $sub['taskType'] === 'task1_academic' && $q['extractedData'] !== null;
    update_owned_submission($id, $user['id'], [
        'promptText' => $q['promptText'],
        'promptImagePath' => $image,
        'extractedData' => $hasData ? $q['extractedData'] : null,
        'extractionUncertain' => null,
        'status' => $hasData ? 'confirmed' : 'draft',
        'questionId' => $q['id'],
    ]);
    return ok(submission_detail_by_id($id, $user['id']));
}

// ---- Sesi ----

function api_create_session(): JsonResponse
{
    $user = require_user();
    return ok(['id' => create_session($user['id'])], 201);
}

function api_get_session(string $id): JsonResponse
{
    $user = require_user();
    return ok(session_view($id, $user['id']));
}

// ---- Database soal ----

function api_list_questions(): JsonResponse
{
    $user = require_user();
    $type = $_GET['task_type'] ?? null;
    if ($type !== null && !in_array($type, ['task1_academic', 'task2'], true)) throw new AppError('VALIDATION_ERROR');
    return ok(list_questions($user, $type));
}

/** Simpan soal dari submission milik user ke database soal bersama. */
function api_create_question(): JsonResponse
{
    $user = require_user();
    $body = request_json();
    $subId = input_uuid($body, 'submission_id');
    $name = input_str($body, 'name', 150, true, 1);
    $sub = get_owned_submission($subId, $user['id']);
    $isTask1 = $sub['taskType'] === 'task1_academic';
    if ($isTask1 && (!$sub['extractedData'] || !in_array($sub['status'], ['confirmed', 'graded'], true))) {
        throw new AppError('QUESTION_NOT_READY');
    }
    if (trim($sub['promptText']) === '' && !$sub['promptImagePath']) throw new AppError('PROMPT_REQUIRED');
    if (db_one('SELECT id FROM `question` WHERE taskType = ? AND name = ?', [$sub['taskType'], $name])) {
        throw new AppError('QUESTION_NAME_TAKEN');
    }
    $id = uuid();
    $image = $sub['promptImagePath'] ? copy_image($sub['promptImagePath'], "questions/$id") : null;
    $now = now_utc();
    try {
        db_insert('question', [
            'id' => $id,
            'taskType' => $sub['taskType'],
            'name' => $name,
            'promptText' => $sub['promptText'],
            'imagePath' => $image,
            'extractedData' => $isTask1 ? $sub['extractedData'] : null,
            'createdById' => $user['id'],
            'createdAt' => $now,
            'updatedAt' => $now,
        ]);
    } catch (PDOException $e) {
        if ($image) delete_image($image);
        if (is_duplicate_key($e)) throw new AppError('QUESTION_NAME_TAKEN');
        throw $e;
    }
    update_owned_submission($subId, $user['id'], ['questionId' => $id]);
    return ok(question_view(get_question($id), $user), 201);
}

function api_get_question(string $id): JsonResponse
{
    $user = require_user();
    return ok(question_view(get_question($id), $user));
}

/** Ubah soal (pembuat atau admin). Submission yang sudah memakai soal ini tidak ikut berubah. */
function api_patch_question(string $id): JsonResponse
{
    $user = require_user();
    $body = request_json();
    $q = get_editable_question($id, $user);
    $data = ['updatedAt' => now_utc()];
    if (($name = input_str($body, 'name', 150, false, 1)) !== null) $data['name'] = $name;
    if (($prompt = input_str($body, 'prompt_text', 5000, false, 0, false)) !== null) $data['promptText'] = $prompt;
    if (array_key_exists('extracted_data', $body) && $body['extracted_data'] !== null) {
        if ($q['taskType'] !== 'task1_academic') throw new AppError('WRONG_TASK_TYPE');
        $ed = parse_extracted_data($body['extracted_data']);
        if ($ed === null) throw new AppError('VALIDATION_ERROR');
        $data['extractedData'] = json_enc($ed);
    }
    try {
        db_update('question', $data, ['id' => $id]);
    } catch (PDOException $e) {
        if (is_duplicate_key($e)) throw new AppError('QUESTION_NAME_TAKEN');
        throw $e;
    }
    return ok(question_view(get_question($id), $user));
}

function api_delete_question(string $id): JsonResponse
{
    $user = require_user();
    $q = get_editable_question($id, $user);
    db_exec('DELETE FROM `question` WHERE id = ?', [$id]);
    if ($q['imagePath']) delete_image($q['imagePath']);
    return ok([]);
}

function api_get_question_image(string $id): never
{
    require_user();
    release_session();
    send_image(get_question($id)['imagePath']);
}

// ---- Speaking ----

function api_create_speaking(): JsonResponse
{
    require_once APP_DIR . '/lib/speaking.php';
    $user = require_user();
    $body = request_json();
    $mode = input_enum($body, 'mode', SPEAKING_MODES);
    $setId = input_str($body, 'set_id', 50, true, 1);
    $student = normalize_student_name(input_str($body, 'student_name', 100, false));
    return ok(['id' => create_speaking_test($user['id'], $student, $setId, $mode)], 201);
}

function api_get_speaking(string $id): JsonResponse
{
    require_once APP_DIR . '/lib/speaking.php';
    $user = require_user();
    return ok(speaking_view(get_owned_speaking($id, $user['id'])));
}

/** Simpan transkrip satu Part (dibuat di browser). Rekam ulang = menimpa. */
function api_put_speaking_transcript(string $id): JsonResponse
{
    require_once APP_DIR . '/lib/speaking.php';
    $user = require_user();
    $body = request_json();
    $t = get_owned_speaking($id, $user['id']);
    if ($t['status'] === 'final') throw new AppError('SPEAKING_LOCKED');
    $part = input_enum($body, 'part', SPEAKING_PARTS);
    if (!in_array($part, speaking_parts($t['mode']), true)) throw new AppError('VALIDATION_ERROR');
    $text = (string) input_str($body, 'text', SPEAKING_TRANSCRIPT_MAX, true, 0);
    $seconds = $body['seconds'] ?? 0;
    if (!is_int($seconds) && !is_float($seconds)) throw new AppError('VALIDATION_ERROR');
    $tr = speaking_transcripts($t);
    $tr[$part] = ['text' => $text, 'misheard' => [], 'seconds' => (int) round($seconds)];
    // Transkrip berubah: penilaian AI lama tidak berlaku lagi.
    update_owned_speaking($id, $user['id'], ['transcripts' => json_enc($tr), 'status' => 'recording']);
    return ok(speaking_view(get_owned_speaking($id, $user['id'])));
}

/** Satu panggilan AI (LR + GRA). Body opsional: misheard = { p1: [indeks kata], ... }. */
function api_assess_speaking(string $id): JsonResponse
{
    require_once APP_DIR . '/llm/speaking.php';
    $user = require_user();
    release_session();
    allow_long_request();
    $body = request_json();
    $t = get_owned_speaking($id, $user['id']);
    if ($t['status'] === 'final') throw new AppError('SPEAKING_LOCKED');
    if (!speaking_transcripts_complete($t)) throw new AppError('SPEAKING_NOT_READY');
    if (isset($body['misheard']) && is_array($body['misheard'])) {
        $tr = speaking_transcripts($t);
        foreach (speaking_parts($t['mode']) as $p) {
            $list = $body['misheard'][$p] ?? [];
            if (!is_array($list)) throw new AppError('VALIDATION_ERROR');
            $max = count(speaking_words($tr[$p]['text']));
            $tr[$p]['misheard'] = array_values(array_unique(array_filter($list, fn($i) => is_int($i) && $i >= 0 && $i < $max)));
        }
        update_owned_speaking($id, $user['id'], ['transcripts' => json_enc($tr)]);
        $t = get_owned_speaking($id, $user['id']);
    }
    return ok(speaking_view(assess_speaking($t, $user['id'])));
}

function api_finalize_speaking(string $id): JsonResponse
{
    require_once APP_DIR . '/lib/speaking.php';
    $user = require_user();
    $body = request_json();
    $t = get_owned_speaking($id, $user['id']);
    if ($t['status'] === 'final') throw new AppError('SPEAKING_LOCKED');
    if ($t['status'] !== 'review') throw new AppError('SPEAKING_NOT_ASSESSED');
    $bands = [];
    foreach (SPEAKING_CRITERIA as $k) $bands[$k] = speaking_band_input($body['bands'][$k] ?? null);
    $comment = input_str($body, 'comment', 3000, false);
    $overall = speaking_overall($bands);
    update_owned_speaking($id, $user['id'], [
        'bandFc' => $bands['fc'],
        'bandLr' => $bands['lr'],
        'bandGra' => $bands['gra'],
        'bandPron' => $bands['pron'],
        'overallRaw' => $overall['raw'],
        'overall' => $overall['band'],
        'examinerComment' => $comment === null || $comment === '' ? null : $comment,
        'status' => 'final',
        'finalizedAt' => now_utc(),
    ]);
    return ok(speaking_view(get_owned_speaking($id, $user['id'])));
}

function api_reopen_speaking(string $id): JsonResponse
{
    require_once APP_DIR . '/lib/speaking.php';
    $user = require_user();
    $t = get_owned_speaking($id, $user['id']);
    if ($t['status'] !== 'final') throw new AppError('VALIDATION_ERROR');
    update_owned_speaking($id, $user['id'], ['status' => 'review']);
    return ok(speaking_view(get_owned_speaking($id, $user['id'])));
}

// ---- Pengaturan AI (milik browser pengguna; server tidak menyimpan apa pun) ----

/** Daftar model yang tersedia untuk key di header X-LLM-* (diisi dari form Pengaturan). */
function api_list_models(): JsonResponse
{
    require_once APP_DIR . '/llm/client.php';
    require_user();
    release_session();
    $llm = request_llm_settings(false);
    if (!$llm) throw new AppError('MODELS_FAILED', 'isi provider dan API key dulu');
    try {
        $models = list_provider_models($llm);
    } catch (Throwable $e) {
        throw new AppError('MODELS_FAILED', str_replace($llm['apiKey'], '••••', $e->getMessage()));
    }
    return ok(['models' => $models]);
}

function api_test_settings(): JsonResponse
{
    require_once APP_DIR . '/llm/connection_test.php';
    require_user();
    release_session();
    allow_long_request();
    $llm = request_llm_settings();
    if (!$llm) throw new AppError('SETTINGS_TEST_FAILED', 'provider, model, dan API key wajib diisi');
    return ok(run_connection_test($llm));
}
