<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/storage.php';
require_once APP_DIR . '/llm/schemas.php';

// Database soal bersama: soal + gambar + data grafik terkonfirmasi, dipakai ulang semua pengguna.

function can_edit_question(array $q, array $user): bool
{
    return $user['is_admin'] || $q['createdById'] === $user['id'];
}

function question_view(array $q, array $user): array
{
    return [
        'id' => $q['id'],
        'task_type' => $q['taskType'],
        'name' => $q['name'],
        'prompt_text' => $q['promptText'],
        'image_url' => $q['imagePath'] ? '/api/questions/' . $q['id'] . '/image' : null,
        'extracted_data' => json_decode_or_null($q['extractedData']),
        'created_by_name' => $q['createdByName'] ?? null,
        'created_at' => iso($q['createdAt']),
        'created_at_text' => format_date($q['createdAt']),
        'can_edit' => can_edit_question($q, $user),
    ];
}

const QUESTION_SELECT = 'SELECT q.*, u.name AS createdByName FROM `question` q LEFT JOIN `user` u ON u.id = q.createdById';

function get_question(string $id): array
{
    $q = db_one(QUESTION_SELECT . ' WHERE q.id = ?', [$id]);
    if (!$q) throw new AppError('NOT_FOUND');
    return $q;
}

function get_editable_question(string $id, array $user): array
{
    $q = get_question($id);
    if (!can_edit_question($q, $user)) throw new AppError('QUESTION_FORBIDDEN');
    return $q;
}

/** Urutan alami: "Cambridge 9" sebelum "Cambridge 10". */
function list_questions(array $user, ?string $taskType = null): array
{
    $rows = $taskType
        ? db_all(QUESTION_SELECT . ' WHERE q.taskType = ?', [$taskType])
        : db_all(QUESTION_SELECT);
    usort($rows, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
    return array_map(fn($q) => question_view($q, $user), $rows);
}

/**
 * Impor soal bawaan dari app/data/questions (56 soal Cambridge 15–21). Soal yang namanya sudah ada dilewati.
 * Mengembalikan jumlah soal baru.
 */
function seed_questions(?string $createdById): int
{
    $dir = APP_DIR . '/data/questions';
    $items = json_decode(file_get_contents("$dir/questions.json"), true, 512, JSON_THROW_ON_ERROR);
    $created = 0;
    foreach ($items as $it) {
        if (db_one('SELECT id FROM `question` WHERE taskType = ? AND name = ?', [$it['task_type'], $it['name']])) continue;
        $data = $it['extracted_data'] !== null ? parse_extracted_data($it['extracted_data']) : null;
        if ($it['extracted_data'] !== null && $data === null) throw new RuntimeException("{$it['name']}: data grafik tidak valid");
        $id = uuid();
        $imagePath = null;
        if ($it['image_file']) {
            $imagePath = 'questions/' . $id . '.' . pathinfo($it['image_file'], PATHINFO_EXTENSION);
            save_image($imagePath, file_get_contents("$dir/images/" . basename($it['image_file'])));
        }
        $now = now_utc();
        db_insert('question', [
            'id' => $id,
            'taskType' => $it['task_type'],
            'name' => $it['name'],
            'promptText' => $it['prompt_text'],
            'imagePath' => $imagePath,
            'extractedData' => $data !== null ? json_enc($data) : null,
            'createdById' => $createdById,
            'createdAt' => $now,
            'updatedAt' => $now,
        ]);
        $created++;
    }
    return $created;
}
