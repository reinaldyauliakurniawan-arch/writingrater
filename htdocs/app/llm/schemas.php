<?php
declare(strict_types=1);

// Skema output AI dalam JSON Schema. Dipakai dua kali: dikirim ke provider (structured output)
// dan memvalidasi jawaban (pengganti zod). Semua objek: semua properti wajib, tanpa properti tambahan.

function s_obj(array $props): array
{
    return ['type' => 'object', 'properties' => $props, 'required' => array_keys($props), 'additionalProperties' => false];
}

function s_str(int $minLength = 0): array
{
    return $minLength > 0 ? ['type' => 'string', 'minLength' => $minLength] : ['type' => 'string'];
}

function s_arr(array $items, ?int $min = null, ?int $max = null): array
{
    $s = ['type' => 'array', 'items' => $items];
    if ($min !== null) $s['minItems'] = $min;
    if ($max !== null) $s['maxItems'] = $max;
    return $s;
}

const CHART_TYPES = ['line', 'bar', 'pie', 'table', 'process', 'map', 'mixed', 'other'];

function schema_extracted_data(): array
{
    return s_obj([
        'chart_type' => ['type' => 'string', 'enum' => CHART_TYPES],
        'title' => s_str(),
        'units' => s_str(),
        'tables' => s_arr(s_obj([
            'name' => s_str(),
            'columns' => s_arr(s_str(), 1),
            'rows' => s_arr(s_obj(['label' => s_str(), 'values' => s_arr(s_str())])),
        ])),
        'process_steps' => s_arr(s_str()),
        'map_changes' => s_arr(s_str()),
        'notes' => s_arr(s_str()),
    ]);
}

function schema_fact_check(): array
{
    return s_obj([
        'fact_errors' => s_arr(s_obj([
            'essay_quote' => s_str(),
            'issue' => s_str(),
            'correct_info' => s_str(),
            'severity' => ['type' => 'string', 'enum' => ['key_feature', 'detail']],
        ])),
        'overview_present' => ['type' => 'boolean'],
        'overview_quote' => ['type' => ['string', 'null']],
        'data_support_present' => ['type' => 'boolean'],
    ]);
}

function schema_criterion(): array
{
    return s_obj([
        'evidence' => s_arr(s_str(), 1, 6),
        'band' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 9],
        'feedback' => s_str(),
        'tip' => ['type' => ['string', 'null']],
    ]);
}

function schema_grade(): array
{
    $c = schema_criterion();
    return s_obj([
        'language_check' => ['type' => 'string', 'enum' => ['english', 'not_english']],
        'criteria' => s_obj(['task' => $c, 'cc' => $c, 'lr' => $c, 'gra' => $c]),
        'ceilings_triggered' => s_arr(s_str()),
    ]);
}

function schema_polish(): array
{
    $list = s_arr(s_obj(['quote' => s_str(1), 'issue' => s_str(), 'correction' => s_str()]), null, 15);
    return s_obj([
        'corrections' => s_obj(['content' => $list, 'cohesion' => $list, 'vocab' => $list, 'grammar' => $list]),
        'polished_text' => s_str(1),
    ]);
}

function schema_connection_test(): array
{
    return s_obj(['numbers' => s_arr(['type' => 'number'])]);
}

/**
 * Validasi nilai terhadap skema di atas. Mengembalikan nilai yang sudah dirapikan
 * (properti tambahan dibuang, integer 7.0 -> 7) atau melempar InvalidArgumentException.
 */
function schema_validate(mixed $v, array $s, string $path = '$'): mixed
{
    $types = (array) $s['type'];
    if ($v === null) {
        if (in_array('null', $types, true)) return null;
        throw new InvalidArgumentException("$path: null");
    }
    $type = $types[0] === 'null' ? ($types[1] ?? 'null') : $types[0];
    switch ($type) {
        case 'object':
            if (!is_array($v) || (array_is_list($v) && $v !== [])) throw new InvalidArgumentException("$path: bukan objek");
            $out = [];
            foreach ($s['properties'] as $k => $ps) {
                if (!array_key_exists($k, $v)) throw new InvalidArgumentException("$path.$k: tidak ada");
                $out[$k] = schema_validate($v[$k], $ps, "$path.$k");
            }
            return $out;
        case 'array':
            if (!is_array($v) || !array_is_list($v)) throw new InvalidArgumentException("$path: bukan array");
            if (isset($s['minItems']) && count($v) < $s['minItems']) throw new InvalidArgumentException("$path: terlalu sedikit");
            if (isset($s['maxItems']) && count($v) > $s['maxItems']) throw new InvalidArgumentException("$path: terlalu banyak");
            return array_map(fn($x) => schema_validate($x, $s['items'], "{$path}[]"), $v);
        case 'string':
            if (!is_string($v)) throw new InvalidArgumentException("$path: bukan string");
            if (isset($s['enum']) && !in_array($v, $s['enum'], true)) throw new InvalidArgumentException("$path: nilai tidak dikenal");
            if (isset($s['minLength']) && mb_strlen($v) < $s['minLength']) throw new InvalidArgumentException("$path: kosong");
            return $v;
        case 'integer':
            if (!(is_int($v) || (is_float($v) && floor($v) === $v))) throw new InvalidArgumentException("$path: bukan integer");
            $v = (int) $v;
            if ((isset($s['minimum']) && $v < $s['minimum']) || (isset($s['maximum']) && $v > $s['maximum'])) {
                throw new InvalidArgumentException("$path: di luar rentang");
            }
            return $v;
        case 'number':
            if (!is_int($v) && !is_float($v)) throw new InvalidArgumentException("$path: bukan angka");
            return $v;
        case 'boolean':
            if (!is_bool($v)) throw new InvalidArgumentException("$path: bukan boolean");
            return $v;
    }
    throw new InvalidArgumentException("$path: tipe $type tidak didukung");
}

/** Validasi tambahan ExtractedData: setiap baris punya jumlah nilai sama dengan jumlah kolom. */
function check_extracted_data(array $d): ?string
{
    foreach ($d['tables'] as $t) {
        foreach ($t['rows'] as $r) {
            if (count($r['values']) !== count($t['columns'])) {
                return sprintf('table "%s" row "%s" has %d values for %d columns', $t['name'], $r['label'], count($r['values']), count($t['columns']));
            }
        }
    }
    return null;
}

/** Data grafik dari browser/database: valid skema + bentuk tabel benar, atau null. */
function parse_extracted_data(mixed $v): ?array
{
    try {
        $d = schema_validate($v, schema_extracted_data());
    } catch (InvalidArgumentException) {
        return null;
    }
    return check_extracted_data($d) === null ? $d : null;
}

const FEEDBACK_MIN_WORDS = 60;
const FEEDBACK_MAX_WORDS = 180;
const TIP_MAX_WORDS = 20;

function plain_words(string $s): int
{
    return count(preg_split('/\s+/u', trim($s), -1, PREG_SPLIT_NO_EMPTY));
}

/** Validasi tambahan 6.4: feedback 60–180 kata, tip ≤ 20 kata. */
function check_grade_output(array $g): ?string
{
    if ($g['language_check'] === 'not_english') return null;
    foreach ($g['criteria'] as $k => $c) {
        $n = plain_words($c['feedback']);
        if ($n < FEEDBACK_MIN_WORDS || $n > FEEDBACK_MAX_WORDS) return "$k.feedback has $n words";
        if ($c['tip'] !== null && plain_words($c['tip']) > TIP_MAX_WORDS) return "$k.tip too long";
    }
    return null;
}

/** Daftar koreksi per kriteria -> daftar datar bertipe. */
function flatten_corrections(array $c): array
{
    $out = [];
    foreach (['content', 'cohesion', 'vocab', 'grammar'] as $type) {
        foreach ($c[$type] as $i) $out[] = $i + ['type' => $type];
    }
    return $out;
}
