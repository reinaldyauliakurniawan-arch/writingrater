<?php
declare(strict_types=1);

// Pemanggilan AI lewat cURL (Anthropic, OpenAI, Google Gemini, endpoint kompatibel OpenAI).
// Setiap request ke server ini menjalankan paling banyak satu tahap AI supaya tidak melewati batas waktu hosting.

require_once APP_DIR . '/lib/settings.php';
require_once APP_DIR . '/llm/schemas.php';

// Batas tunggu jawaban AI. 55 detik terbukti aman di InfinityFree (lesson plan generator); bisa diubah lewat config llm_timeout.
const LLM_TIMEOUT_DEFAULT_S = 55;
const LLM_RETRY_IF_ELAPSED_BELOW = 25; // ulang sekali hanya kalau waktu request masih longgar
// Model reasoning menghitung token "thinking" ke batas output; beri ruang supaya JSON tidak terpotong.
const LLM_REASONING_HEADROOM = 12000;
const LLM_MAX_OUTPUT = 16000;

final class LlmHttpError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0, public readonly string $body = '')
    {
        parent::__construct($message);
    }
}

const QUOTA_PATTERN = '/quota|rate.?limit|resource.?exhausted|credit balance|insufficient.?(balance|funds|credits?)|billing/i';
const KEY_PATTERN = '/api.?key.*(invalid|not valid|incorrect)|invalid.*api.?key|authentication|unauthori[sz]ed/i';
const NO_VISION_PATTERN = '/multimodal|image.{0,40}(not supported|unsupported|not enabled)|(does not|doesn\'t|not) support.{0,20}image|vision.{0,20}(not supported|unsupported)|image_url/i';

/** Error provider yang tidak sembuh dengan retry: kuota habis atau key ditolak. */
function provider_error_code(Throwable $e): ?string
{
    if (!$e instanceof LlmHttpError || $e->status === 0) return null;
    $text = $e->getMessage() . ' ' . $e->body;
    if ($e->status === 429 || $e->status === 402 || preg_match(QUOTA_PATTERN, $text)) return 'LLM_QUOTA_EXCEEDED';
    if ($e->status === 401 || $e->status === 403 || preg_match(KEY_PATTERN, $text)) return 'LLM_KEY_INVALID';
    return null;
}

function is_no_vision_error(Throwable $e): bool
{
    $text = $e->getMessage() . ($e instanceof LlmHttpError ? ' ' . $e->body : '');
    return (bool) preg_match(NO_VISION_PATTERN, $text);
}

function is_reasoning_openai_model(string $model): bool
{
    return (bool) preg_match('/^(o\d|gpt-5)/i', $model);
}

function schema_instruction(array $schema): string
{
    return "\n\nRespond with only one JSON object (no markdown, no explanation) that matches this JSON Schema:\n"
        . json_enc($schema);
}

/**
 * Bentuk HTTP request untuk satu panggilan.
 * $call: name, schema, system, content (parts: text|image), maxTokens, flags (no_json_schema, no_response_format).
 */
function llm_build_request(array $llm, array $call): array
{
    $max = min(LLM_MAX_OUTPUT, $call['maxTokens'] + LLM_REASONING_HEADROOM);
    $flags = $call['flags'] ?? [];
    switch ($llm['provider']) {
        case 'anthropic':
            $content = [];
            foreach ($call['content'] as $p) {
                $content[] = $p['type'] === 'image'
                    ? ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $p['mime'], 'data' => base64_encode($p['data'])]]
                    : ['type' => 'text', 'text' => $p['text']];
            }
            return [
                'url' => 'https://api.anthropic.com/v1/messages',
                'headers' => ['x-api-key: ' . $llm['apiKey'], 'anthropic-version: 2023-06-01', 'content-type: application/json'],
                'body' => [
                    'model' => $llm['model'],
                    'max_tokens' => $max,
                    'temperature' => 0,
                    'system' => $call['system'],
                    'messages' => [['role' => 'user', 'content' => $content]],
                    'tools' => [['name' => $call['name'], 'description' => 'Return the result.', 'input_schema' => $call['schema']]],
                    'tool_choice' => ['type' => 'tool', 'name' => $call['name']],
                ],
            ];

        case 'google':
            $parts = [];
            foreach ($call['content'] as $p) {
                $parts[] = $p['type'] === 'image'
                    ? ['inline_data' => ['mime_type' => $p['mime'], 'data' => base64_encode($p['data'])]]
                    : ['text' => $p['text']];
            }
            $gen = ['temperature' => 0, 'maxOutputTokens' => $max, 'responseMimeType' => 'application/json'];
            if (empty($flags['no_json_schema'])) $gen['responseJsonSchema'] = $call['schema'];
            return [
                'url' => 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($llm['model']) . ':generateContent',
                'headers' => ['x-goog-api-key: ' . $llm['apiKey'], 'content-type: application/json'],
                'body' => [
                    'systemInstruction' => ['parts' => [['text' => $call['system'] . schema_instruction($call['schema'])]]],
                    'contents' => [['role' => 'user', 'parts' => $parts]],
                    'generationConfig' => $gen,
                ],
            ];

        case 'openai':
        case 'openai_compatible':
            $compat = $llm['provider'] === 'openai_compatible';
            $content = [];
            foreach ($call['content'] as $p) {
                $content[] = $p['type'] === 'image'
                    ? ['type' => 'image_url', 'image_url' => ['url' => 'data:' . $p['mime'] . ';base64,' . base64_encode($p['data'])]]
                    : ['type' => 'text', 'text' => $p['text']];
            }
            $body = [
                'model' => $llm['model'],
                'messages' => [
                    ['role' => 'system', 'content' => $call['system'] . ($compat ? schema_instruction($call['schema']) : '')],
                    ['role' => 'user', 'content' => $content],
                ],
            ];
            if ($compat) {
                $body['max_tokens'] = $max;
                $body['temperature'] = 0;
                if (empty($flags['no_response_format'])) $body['response_format'] = ['type' => 'json_object'];
            } else {
                $body['max_completion_tokens'] = $max;
                if (!is_reasoning_openai_model($llm['model'])) $body['temperature'] = 0;
                $body['response_format'] = [
                    'type' => 'json_schema',
                    'json_schema' => ['name' => $call['name'], 'strict' => true, 'schema' => $call['schema']],
                ];
            }
            $base = $compat ? rtrim((string) $llm['baseUrl'], '/') : 'https://api.openai.com/v1';
            return [
                'url' => $base . '/chat/completions',
                'headers' => ['Authorization: Bearer ' . $llm['apiKey'], 'content-type: application/json'],
                'body' => $body,
            ];
    }
    throw new RuntimeException('provider tidak dikenal');
}

/** Ambil teks/objek dari respons provider. ['raw' => mixed, 'usage' => [in, out]] */
function llm_parse_response(string $provider, array $res): array
{
    switch ($provider) {
        case 'anthropic':
            foreach ($res['content'] ?? [] as $block) {
                if (($block['type'] ?? '') === 'tool_use') {
                    return ['raw' => $block['input'], 'usage' => [$res['usage']['input_tokens'] ?? null, $res['usage']['output_tokens'] ?? null]];
                }
            }
            throw new RuntimeException('Respons Anthropic tanpa tool_use (stop_reason: ' . ($res['stop_reason'] ?? '?') . ')');

        case 'google':
            $cand = $res['candidates'][0] ?? null;
            if (!$cand) throw new RuntimeException('Respons Gemini kosong: ' . substr(json_enc($res['promptFeedback'] ?? $res), 0, 300));
            if (($cand['finishReason'] ?? '') === 'MAX_TOKENS') throw new RuntimeException('Jawaban terpotong (MAX_TOKENS)');
            $text = '';
            foreach ($cand['content']['parts'] ?? [] as $p) {
                if (!empty($p['thought'])) continue;
                $text .= $p['text'] ?? '';
            }
            $u = $res['usageMetadata'] ?? [];
            return ['raw' => decode_json_text($text), 'usage' => [$u['promptTokenCount'] ?? null, $u['candidatesTokenCount'] ?? null]];

        default: // openai, openai_compatible
            $choice = $res['choices'][0] ?? null;
            if (!$choice) throw new RuntimeException('Respons tanpa choices');
            if (($choice['finish_reason'] ?? '') === 'length') throw new RuntimeException('Jawaban terpotong (length)');
            $msg = $choice['message'] ?? [];
            if (!empty($msg['refusal'])) throw new RuntimeException('Model menolak: ' . $msg['refusal']);
            $u = $res['usage'] ?? [];
            return ['raw' => decode_json_text((string) ($msg['content'] ?? '')), 'usage' => [$u['prompt_tokens'] ?? null, $u['completion_tokens'] ?? null]];
    }
}

/**
 * JSON dari teks model. Tahan terhadap: blok <think>…</think>, pagar ```json, teks penjelasan sebelum/sesudah,
 * dan kurung kurawal di luar jawaban. Mengambil objek JSON valid terakhir (jawaban biasanya di akhir).
 */
function decode_json_text(string $text): mixed
{
    $t = trim(preg_replace('#<think(?:ing)?>.*?</think(?:ing)?>#is', '', $text));
    $t = preg_replace('#^.*</think(?:ing)?>#is', '', $t); // tag pembuka terpotong
    $direct = json_decode($t, true);
    if (is_array($direct)) return $direct;
    if (preg_match_all('/```(?:json)?\s*(.*?)```/is', $t, $m)) {
        foreach (array_reverse($m[1]) as $block) {
            $v = json_decode(trim($block), true);
            if (is_array($v)) return $v;
        }
    }
    $found = null;
    foreach (json_object_candidates($t) as $candidate) {
        $v = json_decode($candidate, true);
        if (is_array($v)) $found = $v;
    }
    if ($found !== null) return $found;
    $snippet = mb_substr(preg_replace('/\s+/', ' ', $t), 0, 160);
    throw new RuntimeException('Jawaban model bukan JSON yang valid' . ($snippet !== '' ? " (awal jawaban: \"$snippet\")" : ' (jawaban kosong)'));
}

/** Potongan teks {…} dengan kurung seimbang (memperhatikan string), dari kiri ke kanan. */
function json_object_candidates(string $t): array
{
    $out = [];
    $len = strlen($t);
    for ($i = 0; $i < $len; $i++) {
        if ($t[$i] !== '{') continue;
        $depth = 0;
        $inStr = false;
        for ($j = $i; $j < $len; $j++) {
            $c = $t[$j];
            if ($inStr) {
                if ($c === '\\') $j++;
                elseif ($c === '"') $inStr = false;
                continue;
            }
            if ($c === '"') $inStr = true;
            elseif ($c === '{') $depth++;
            elseif ($c === '}' && --$depth === 0) {
                $out[] = substr($t, $i, $j - $i + 1);
                $i = $j; // lanjut setelah objek ini
                break;
            }
        }
    }
    return $out;
}

function curl_handle(array $req)
{
    $ch = curl_init($req['url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $req['headers'],
        CURLOPT_POSTFIELDS => json_enc($req['body']),
        CURLOPT_TIMEOUT => (int) (config('llm_timeout') ?: LLM_TIMEOUT_DEFAULT_S),
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    return $ch;
}

/** Hasil satu handle cURL -> array JSON respons, atau lempar LlmHttpError. $curlCode dari curl_multi_info_read. */
function curl_result($ch, string $body, string $apiKey, int $curlCode = CURLE_OK): array
{
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch) ?: ($curlCode !== CURLE_OK ? curl_strerror($curlCode) : '');
    if ($curlCode === CURLE_OPERATION_TIMEDOUT || str_contains($err, 'timed out')) {
        throw new LlmHttpError('Model AI tidak menjawab dalam ' . (int) (config('llm_timeout') ?: LLM_TIMEOUT_DEFAULT_S) . ' detik (timeout). Pakai model yang lebih cepat.');
    }
    if ($err !== '') throw new LlmHttpError('Koneksi ke AI gagal: ' . $err);
    $json = json_decode($body, true);
    if ($status < 200 || $status >= 300) {
        // Format error tiap provider berbeda: {error:{message}}, {error:"..."}, {message}, {detail}, {title}, atau teks biasa.
        $msg = '';
        if (is_array($json)) {
            $err = $json['error'] ?? null;
            $msg = is_array($err) ? ($err['message'] ?? $err['status'] ?? '') : ($err ?? '');
            $msg = $msg ?: ($json['message'] ?? $json['detail'] ?? $json['title'] ?? '');
            if (!is_string($msg)) $msg = json_enc($msg);
        }
        if ($msg === '') $msg = trim(strip_tags(substr($body, 0, 300)));
        $safe = str_replace($apiKey, '••••', substr($body, 0, 2000));
        $msg = $apiKey !== '' ? str_replace($apiKey, '••••', $msg) : $msg;
        $hint = in_array($status, [401, 403], true) ? ' (API key ditolak provider: cek key, provider, dan model yang dipilih)' : '';
        throw new LlmHttpError("HTTP $status" . ($msg !== '' ? ": $msg" : '') . $hint, $status, $safe);
    }
    if (!is_array($json)) throw new LlmHttpError('Respons AI bukan JSON', $status, substr($body, 0, 500));
    return $json;
}

/**
 * Jalankan beberapa request sekaligus (curl_multi). Hasil per indeks: ['ok' => array] atau ['error' => Throwable].
 */
function llm_http_many(array $llm, array $requests): array
{
    $mh = curl_multi_init();
    $handles = [];
    foreach ($requests as $i => $req) {
        $handles[$i] = curl_handle($req);
        curl_multi_add_handle($mh, $handles[$i]);
    }
    $codes = [];
    do {
        $status = curl_multi_exec($mh, $running);
        while ($info = curl_multi_info_read($mh)) $codes[spl_object_id($info['handle'])] = $info['result'];
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running && $status === CURLM_OK);
    while ($info = curl_multi_info_read($mh)) $codes[spl_object_id($info['handle'])] = $info['result'];
    $out = [];
    foreach ($handles as $i => $ch) {
        try {
            $code = $codes[spl_object_id($ch)] ?? CURLE_OK;
            $out[$i] = ['ok' => curl_result($ch, (string) curl_multi_getcontent($ch), $llm['apiKey'], $code)];
        } catch (Throwable $e) {
            $out[$i] = ['error' => $e];
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $out;
}

function llm_label(array $llm): string
{
    return $llm['provider'] . ':' . $llm['model'];
}

function llm_active(): array
{
    if (config('llm_mock')) return ['provider' => 'mock', 'model' => 'mock', 'apiKey' => '', 'baseUrl' => null];
    $llm = get_settings()['llm'];
    if (!$llm) throw new AppError('LLM_NOT_CONFIGURED');
    return $llm;
}

function write_llm_log(?array $log, string $model, ?array $usage, bool $success, ?string $error = null): void
{
    if (!$log) return;
    db_insert('llmcall', [
        'userId' => $log['userId'],
        'submissionId' => $log['submissionId'] ?? null,
        'action' => $log['action'],
        'actionId' => $log['actionId'],
        'kind' => $log['kind'],
        'model' => $model,
        'inputTokens' => $usage[0] ?? null,
        'outputTokens' => $usage[1] ?? null,
        'success' => $success ? 1 : 0,
        'error' => $error !== null ? mb_substr($error, 0, 2000) : null,
        'createdAt' => now_utc(),
    ]);
}

/** Fixture LLM mock: app/fixtures/{set}/{name}.json lalu app/fixtures/{name}.json. */
function read_fixture(string $name): mixed
{
    $set = $_SERVER['HTTP_X_LLM_MOCK_SET'] ?? '';
    $candidates = [];
    if (config('debug') && preg_match('/^[a-z0-9-]+$/', $set)) $candidates[] = APP_DIR . "/fixtures/$set/$name.json";
    $candidates[] = APP_DIR . "/fixtures/$name.json";
    foreach ($candidates as $f) if (is_file($f)) return json_decode(file_get_contents($f), true);
    throw new RuntimeException("fixture $name.json tidak ditemukan");
}

/** Validasi skema + validasi tambahan; lempar kalau gagal. */
function llm_check(array $call, mixed $raw): array
{
    $value = schema_validate($raw, $call['schema']);
    if (isset($call['validate']) && ($msg = ($call['validate'])($value))) throw new RuntimeException("validation: $msg");
    return $value;
}

/** Ubah request sesuai error provider yang bisa diakali (gambar/format tidak didukung). true = layak dicoba lagi. */
function llm_adapt_after_error(array &$call, Throwable $e, string $provider): bool
{
    if (is_no_vision_error($e) && array_filter($call['content'], fn($p) => $p['type'] === 'image')) {
        if ($call['name'] === 'extract') throw new AppError('LLM_NO_VISION');
        $call['content'] = array_values(array_filter($call['content'], fn($p) => $p['type'] === 'text'));
        return true;
    }
    if ($e instanceof LlmHttpError && $e->status === 400) {
        $text = $e->getMessage() . ' ' . $e->body;
        if ($provider === 'google' && empty($call['flags']['no_json_schema']) && preg_match('/response_?json_?schema|responseJsonSchema/i', $text)) {
            $call['flags']['no_json_schema'] = true;
            return true;
        }
        if ($provider === 'openai_compatible' && empty($call['flags']['no_response_format']) && preg_match('/response_format|json_object/i', $text)) {
            $call['flags']['no_response_format'] = true;
            return true;
        }
    }
    return false;
}

/**
 * Beberapa panggilan structured output sekaligus (paralel). Setiap panggilan: 1x retry kalau waktu masih cukup.
 * $calls[i]: name, schema, system, content, maxTokens, log (array|null), validate (callable|null), fixture.
 * Hasil: daftar ['value' => array, 'model' => label]. Melempar AppError kalau ada yang gagal.
 */
function llm_structured_many(array $calls): array
{
    $llm = llm_active();
    $label = llm_label($llm);
    $results = [];
    $pending = array_keys($calls);
    $attempts = array_fill_keys($pending, 0);
    $lastError = [];

    while ($pending) {
        $responses = [];
        if (config('llm_mock')) {
            foreach ($pending as $i) {
                $attempts[$i]++;
                $raw = read_fixture($calls[$i]['fixture'] ?? $calls[$i]['name']);
                $responses[$i] = ['mock' => $raw];
            }
        } else {
            $reqs = [];
            foreach ($pending as $i) {
                $attempts[$i]++;
                $reqs[$i] = llm_build_request($llm, $calls[$i]);
            }
            $responses = llm_http_many($llm, $reqs);
        }

        $retry = [];
        foreach ($pending as $i) {
            $call = $calls[$i];
            $usage = null;
            try {
                $r = $responses[$i];
                if (isset($r['error'])) throw $r['error'];
                if (array_key_exists('mock', $r)) {
                    $raw = $r['mock'];
                } else {
                    $parsed = llm_parse_response($llm['provider'], $r['ok']);
                    $usage = $parsed['usage'];
                    $raw = $parsed['raw'];
                }
                $results[$i] = ['value' => llm_check($call, $raw), 'model' => $label];
                write_llm_log($call['log'] ?? null, $label, $usage, true);
            } catch (AppError $e) {
                throw $e;
            } catch (Throwable $e) {
                $lastError[$i] = $e;
                write_llm_log($call['log'] ?? null, $label, $usage, false, get_class($e) . ': ' . $e->getMessage());
                if ($code = provider_error_code($e)) throw new AppError($code);
                // Timeout tidak diulang: request ini sudah memakai hampir seluruh waktu yang aman di hosting.
                if ($e instanceof LlmHttpError && str_contains($e->getMessage(), '(timeout)')) throw new AppError('LLM_TIMEOUT');
                $adapted = llm_adapt_after_error($calls[$i], $e, $llm['provider']);
                if ($adapted) $attempts[$i]--; // perubahan format tidak dihitung sebagai percobaan
                $elapsed = microtime(true) - REQUEST_START;
                if ($attempts[$i] < 2 && ($adapted || $elapsed < LLM_RETRY_IF_ELAPSED_BELOW)) $retry[] = $i;
            }
        }
        if (array_diff($pending, array_keys($results), $retry)) {
            $failed = array_values(array_diff($pending, array_keys($results), $retry))[0];
            error_log('LLM gagal: ' . ($lastError[$failed] ?? new RuntimeException('?'))->getMessage());
            throw new AppError('LLM_FAILED');
        }
        $pending = $retry;
        if ($pending && !config('llm_mock')) sleep(2);
    }
    ksort($results);
    return $results;
}

function llm_structured(array $call): array
{
    return llm_structured_many([$call])[0];
}

/**
 * Daftar model chat dari provider (dipakai pemilih model di Pengaturan). Hasil: daftar id model, urut abjad.
 */
function list_provider_models(array $llm): array
{
    $key = $llm['apiKey'];
    [$url, $headers] = match ($llm['provider']) {
        'anthropic' => ['https://api.anthropic.com/v1/models?limit=1000', ['x-api-key: ' . $key, 'anthropic-version: 2023-06-01']],
        'openai' => ['https://api.openai.com/v1/models', ['Authorization: Bearer ' . $key]],
        'google' => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', ['x-goog-api-key: ' . $key]],
        default => [rtrim((string) $llm['baseUrl'], '/') . '/models', ['Authorization: Bearer ' . $key]],
    };
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10]);
    $res = curl_result($ch, (string) curl_exec($ch), $key, curl_errno($ch));

    if ($llm['provider'] === 'google') {
        $ids = [];
        foreach ($res['models'] ?? [] as $m) {
            if (in_array('generateContent', $m['supportedGenerationMethods'] ?? [], true)) $ids[] = preg_replace('#^models/#', '', $m['name']);
        }
    } else {
        $ids = array_column($res['data'] ?? [], 'id');
    }
    // Buang model yang jelas bukan model chat (embedding, rerank, gambar, suara, moderasi).
    $ids = array_values(array_filter($ids, fn($id) => is_string($id)
        && !preg_match('/embed|rerank|retriev|guard|safety|moderation|whisper|tts|dall-e|image|audio|realtime|transcribe|clip|ocr|parse|reward|translate/i', $id)));
    if ($llm['provider'] === 'openai') $ids = array_values(array_filter($ids, fn($id) => preg_match('/^(gpt|o\d|chatgpt)/', $id)));
    sort($ids, SORT_NATURAL | SORT_FLAG_CASE);
    return $ids;
}
