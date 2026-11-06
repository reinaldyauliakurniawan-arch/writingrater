<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/scoring.php';

// Fitur Speaking (PRD Speaking.md): bank soal, descriptor, data ujian, dan bentuk respons.
// Audio tidak pernah sampai ke server; yang disimpan hanya transkrip dari browser dan nilai.

const SPEAKING_MODES = ['p1', 'p2', 'p3', 'full'];
const SPEAKING_PARTS = ['p1', 'p2', 'p3'];
const SPEAKING_MODE_LABELS = ['p1' => 'Part 1', 'p2' => 'Part 2', 'p3' => 'Part 3', 'full' => 'Lengkap (Part 1–3)'];
const SPEAKING_CRITERIA = ['fc', 'lr', 'gra', 'pron'];
const SPEAKING_CRITERION_NAMES = [
    'fc' => 'Fluency & Coherence',
    'lr' => 'Lexical Resource',
    'gra' => 'Grammatical Range & Accuracy',
    'pron' => 'Pronunciation',
];
const SPEAKING_MIN_WORDS = 10;
const SPEAKING_TRANSCRIPT_MAX = 20000;

function speaking_sets(): array
{
    static $sets = null;
    $sets ??= json_decode(file_get_contents(APP_DIR . '/data/speaking/sets.json'), true, 512, JSON_THROW_ON_ERROR);
    return $sets;
}

function speaking_set(string $id): array
{
    foreach (speaking_sets() as $s) if ($s['id'] === $id) return $s;
    throw new AppError('NOT_FOUND');
}

/** Daftar ringkas untuk pilihan di form. */
function speaking_set_options(): array
{
    return array_map(fn($s) => ['id' => $s['id'], 'name' => $s['name'], 'part2' => $s['part2']['title']], speaking_sets());
}

function speaking_descriptors(): array
{
    static $d = null;
    $d ??= json_decode(file_get_contents(APP_DIR . '/kb/speaking_descriptors.json'), true, 512, JSON_THROW_ON_ERROR);
    return $d;
}

/** Part yang diujikan untuk sebuah mode. */
function speaking_parts(string $mode): array
{
    return $mode === 'full' ? SPEAKING_PARTS : [$mode];
}

function get_owned_speaking(string $id, string $userId): array
{
    $t = db_one('SELECT * FROM `speakingtest` WHERE id = ? AND userId = ?', [$id, $userId]);
    if (!$t) throw new AppError('NOT_FOUND');
    return $t;
}

function update_owned_speaking(string $id, string $userId, array $data): void
{
    db_update('speakingtest', $data + ['updatedAt' => now_utc()], ['id' => $id, 'userId' => $userId]);
}

function create_speaking_test(string $userId, ?string $student, string $setId, string $mode): string
{
    speaking_set($setId);
    $id = uuid();
    $now = now_utc();
    db_insert('speakingtest', [
        'id' => $id,
        'userId' => $userId,
        'studentName' => $student,
        'setId' => $setId,
        'mode' => $mode,
        'status' => 'recording',
        'transcripts' => json_enc((object) []),
        'createdAt' => $now,
        'updatedAt' => $now,
    ]);
    return $id;
}

function speaking_transcripts(array $t): array
{
    $tr = json_decode_or_null($t['transcripts']);
    return is_array($tr) ? $tr : [];
}

/** Kata-kata transkrip (dipisah spasi), sama dengan pemecahan di browser untuk tanda "salah dengar". */
function speaking_words(string $text): array
{
    return preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];
}

function speaking_word_total(array $transcripts, array $parts): int
{
    $n = 0;
    foreach ($parts as $p) $n += count(speaking_words($transcripts[$p]['text'] ?? ''));
    return $n;
}

/** Semua Part dari mode ini sudah punya transkrip. */
function speaking_transcripts_complete(array $t): bool
{
    $tr = speaking_transcripts($t);
    foreach (speaking_parts($t['mode']) as $p) if (!isset($tr[$p]['text'])) return false;
    return true;
}

/** ['raw' => rata-rata 4 kriteria, 'band' => dibulatkan ke 0.5]. */
function speaking_overall(array $bands): array
{
    $raw = array_sum($bands) / count($bands);
    return ['raw' => $raw, 'band' => round_half($raw)];
}

function speaking_band_input(mixed $v): int
{
    if (!is_int($v) || $v < 0 || $v > 9) throw new AppError('VALIDATION_ERROR');
    return $v;
}

/** Descriptor resmi satu band untuk satu kriteria (+ band pembanding untuk Pronunciation 7/5/3). */
function speaking_descriptor_view(string $criterion, int $band): array
{
    $d = speaking_descriptors();
    $see = [];
    foreach ($d['see_bands'][$criterion][(string) $band] ?? [] as $b) {
        $see[] = ['band' => $b, 'lines' => $d['bands'][(string) $b][$criterion]];
    }
    return ['lines' => $d['bands'][(string) $band][$criterion], 'see' => $see];
}

/** Bentuk data untuk halaman dan API. */
function speaking_view(array $t): array
{
    $set = speaking_set($t['setId']);
    $parts = speaking_parts($t['mode']);
    $tr = speaking_transcripts($t);
    $ai = json_decode_or_null($t['aiResult']);
    $final = $t['status'] === 'final';
    $bands = ['fc' => $t['bandFc'], 'lr' => $t['bandLr'], 'gra' => $t['bandGra'], 'pron' => $t['bandPron']];
    $bands = array_map(fn($b) => $b === null ? null : (int) $b, $bands);
    $criteria = null;
    if ($final) {
        $criteria = array_map(function ($k) use ($bands, $ai, $t) {
            $isAi = in_array($k, ['lr', 'gra'], true);
            $aiBand = $isAi ? ($t[$k === 'lr' ? 'aiBandLr' : 'aiBandGra'] ?? null) : null;
            $changed = $isAi && ($aiBand === null || (int) $aiBand !== $bands[$k]);
            return [
                'key' => $k,
                'name' => SPEAKING_CRITERION_NAMES[$k],
                'band' => $bands[$k],
                'by' => $isAi ? ($changed ? 'examiner' : 'ai') : 'examiner',
                'descriptor' => speaking_descriptor_view($k, $bands[$k]),
                'summary' => $isAi && !$changed ? ($ai[$k]['summary'] ?? null) : null,
                'examples' => $isAi ? ($ai[$k]['examples'] ?? []) : [],
            ];
        }, SPEAKING_CRITERIA);
    }
    return [
        'id' => $t['id'],
        'status' => $t['status'],
        'student_name' => $t['studentName'],
        'mode' => $t['mode'],
        'mode_label' => SPEAKING_MODE_LABELS[$t['mode']],
        'parts' => $parts,
        'set' => $set,
        'transcripts' => (object) $tr,
        'ai' => $ai ? [
            'lr' => ['band' => $ai['lr']['band'], 'summary' => $ai['lr']['summary'], 'examples' => $ai['lr']['examples']],
            'gra' => ['band' => $ai['gra']['band'], 'summary' => $ai['gra']['summary'], 'examples' => $ai['gra']['examples']],
        ] : null,
        'bands' => $bands,
        'overall' => $t['overall'] !== null ? (float) $t['overall'] : null,
        'label' => $t['mode'] === 'full' ? 'Skor simulasi' : 'Estimasi latihan',
        'criteria' => $criteria,
        'examiner_comment' => $t['examinerComment'],
        'last_error_code' => $t['lastErrorCode'],
        'created_at' => iso($t['createdAt']),
        'finalized_at' => iso($t['finalizedAt']),
        'finalized_at_text' => format_date($t['finalizedAt']),
    ];
}

function speaking_list(string $userId): array
{
    $rows = db_all('SELECT id, studentName, setId, mode, status, overall, createdAt FROM `speakingtest` WHERE userId = ? ORDER BY createdAt DESC LIMIT 100', [$userId]);
    $names = array_column(speaking_sets(), 'name', 'id');
    return array_map(fn($r) => [
        'id' => $r['id'],
        'student_name' => $r['studentName'],
        'set_name' => $names[$r['setId']] ?? $r['setId'],
        'mode_label' => SPEAKING_MODE_LABELS[$r['mode']],
        'status' => $r['status'],
        'overall' => $r['overall'] !== null ? (float) $r['overall'] : null,
        'created_at_text' => format_date($r['createdAt']),
    ], $rows);
}
