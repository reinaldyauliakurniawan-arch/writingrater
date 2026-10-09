<?php
declare(strict_types=1);

require_once APP_DIR . '/llm/client.php';

const CONNECTION_EXPECTED = [42, 17];

/** Hasil satu tes: ['ok' => bool, 'raw' => mixed] atau lempar error HTTP/parse. */
function connection_test_call(array $llm, array $content): array
{
    $call = [
        'name' => 'connection_test',
        'schema' => schema_connection_test(),
        'system' => 'You read numbers from charts.',
        'content' => $content,
        'maxTokens' => 200,
    ];
    $res = llm_http_many($llm, [llm_build_request($llm, $call)])[0];
    if (isset($res['error'])) throw $res['error'];
    $value = schema_validate(llm_parse_response($llm['provider'], $res['ok'])['raw'], $call['schema']);
    return $value['numbers'];
}

/**
 * Tes koneksi (6.6): gambar bar chart berisi 42 dan 17. Model teks saja tetap boleh: dites tanpa gambar.
 * Selalu memanggil API asli. Tidak menulis llmcall.
 */
function run_connection_test(array $llm): array
{
    $started = microtime(true);
    $ms = fn() => (int) round((microtime(true) - $started) * 1000);
    $scrub = fn(string $m) => mb_substr($llm['apiKey'] ? str_replace($llm['apiKey'], '••••', $m) : $m, 0, 500);
    $image = ['data' => file_get_contents(APP_DIR . '/fixtures/connection-test.png'), 'mime' => 'image/png'];
    try {
        $numbers = connection_test_call($llm, [image_part($image), text_part('Return the two numbers shown in the chart.')]);
        $label = 'Model tidak membaca angka dengan benar';
    } catch (Throwable $e) {
        if (!is_no_vision_error($e)) return ['ok' => false, 'latency_ms' => $ms(), 'error' => $scrub($e->getMessage())];
        try {
            $numbers = connection_test_call($llm, [text_part('A chart shows two bars labelled 42 and 17. Return those two numbers.')]);
            $label = 'Model tidak mengembalikan angka yang benar';
        } catch (Throwable $e2) {
            return ['ok' => false, 'latency_ms' => $ms(), 'error' => $scrub($e2->getMessage())];
        }
    }
    $ok = !array_diff(CONNECTION_EXPECTED, array_map(fn($n) => (int) round($n), $numbers));
    return $ok
        ? ['ok' => true, 'latency_ms' => $ms()]
        : ['ok' => false, 'latency_ms' => $ms(), 'error' => "$label (mendapat: " . ($numbers ? implode(', ', $numbers) : '-') . ')'];
}
