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
        ['GET', '#^/api/settings$#', 'api_get_settings'],
        ['PUT', '#^/api/settings$#', 'api_put_settings'],
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
    $sub = get_owned_submission($id, $user['id']);
    if ($sub['status'] === 'graded') throw new AppError('SUBMISSION_LOCKED');
    $data = [];
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

// ---- Pengaturan AI (admin) ----

function api_get_settings(): JsonResponse
{
    require_admin();
    return ok(public_settings());
}

/** Input pengaturan: [provider, model, baseUrl|null, apiKey|null]. */
function settings_input(bool $requireModel = true): array
{
    $body = request_json();
    $provider = input_enum($body, 'provider', PROVIDERS);
    $model = (string) input_str($body, 'model', 200, $requireModel, $requireModel ? 1 : 0);
    $baseUrl = input_str($body, 'base_url', 500, false) ?: null;
    $apiKey = input_str($body, 'api_key', 500, false) ?: null;
    if (requires_base_url($provider)) {
        if (!$baseUrl || !is_valid_base_url($baseUrl)) throw new AppError('VALIDATION_ERROR');
    } else {
        $baseUrl = null;
    }
    return [$provider, $model, $baseUrl, $apiKey];
}

/** Daftar model yang tersedia untuk key ini (key baru dari form, atau key tersimpan). */
function api_list_models(): JsonResponse
{
    require_once APP_DIR . '/llm/client.php';
    require_admin();
    release_session();
    [$provider, $model, $baseUrl, $apiKey] = settings_input(false);
    $apiKey ??= stored_api_key();
    if (!$apiKey) throw new AppError('SETTINGS_TEST_FAILED', 'API key belum diisi');
    try {
        $models = list_provider_models(['provider' => $provider, 'model' => $model, 'apiKey' => $apiKey, 'baseUrl' => $baseUrl]);
    } catch (Throwable $e) {
        throw new AppError('MODELS_FAILED', $e->getMessage());
    }
    return ok(['models' => $models]);
}

function api_test_settings(): JsonResponse
{
    require_once APP_DIR . '/llm/connection_test.php';
    require_admin();
    release_session();
    allow_long_request();
    [$provider, $model, $baseUrl, $apiKey] = settings_input();
    $apiKey ??= stored_api_key();
    if (!$apiKey) throw new AppError('VALIDATION_ERROR');
    return ok(run_connection_test(['provider' => $provider, 'model' => $model, 'apiKey' => $apiKey, 'baseUrl' => $baseUrl]));
}

function api_put_settings(): JsonResponse
{
    require_once APP_DIR . '/llm/connection_test.php';
    $admin = require_admin();
    release_session();
    allow_long_request();
    [$provider, $model, $baseUrl, $apiKey] = settings_input();
    $row = get_settings()['row'];
    // Tes wajib hanya kalau AI aktif berubah: key baru, atau key tersimpan dengan provider/model/base_url baru.
    $changed = !$row || $row['provider'] !== $provider || $row['model'] !== $model || ($row['baseUrl'] ?? null) !== $baseUrl;
    $needsTest = $apiKey !== null || (!empty($row['apiKeyEncrypted']) && $changed);
    $testOk = null;
    if ($needsTest) {
        $key = $apiKey ?? stored_api_key();
        if (!$key) throw new AppError('SETTINGS_TEST_FAILED', 'API key belum diisi');
        // Server selalu menjalankan ulang tes; hasil tes di browser tidak dipercaya.
        $test = run_connection_test(['provider' => $provider, 'model' => $model, 'apiKey' => $key, 'baseUrl' => $baseUrl]);
        if (!$test['ok']) throw new AppError('SETTINGS_TEST_FAILED', $test['error'] ?? 'tidak diketahui');
        $testOk = true;
    }
    save_settings($provider, $model, $baseUrl, $apiKey, $testOk, $admin['email']);
    return ok(public_settings());
}
