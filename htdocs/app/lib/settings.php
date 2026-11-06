<?php
declare(strict_types=1);

// Pengaturan AI milik masing-masing pengguna. Provider, model, base URL, dan API key disimpan di
// browser (localStorage) dan dikirim bersama setiap request AI lewat header X-LLM-*.
// Server hanya meneruskan ke provider: tidak menyimpan dan tidak mencatat API key.

const PROVIDERS = ['anthropic', 'openai', 'google', 'openai_compatible'];
const PROVIDER_OPTIONS = [
    ['value' => 'anthropic', 'label' => 'Anthropic', 'modelPlaceholder' => 'claude-sonnet-5-5', 'needsBaseUrl' => false],
    ['value' => 'openai', 'label' => 'OpenAI', 'modelPlaceholder' => 'gpt-5.1', 'needsBaseUrl' => false],
    ['value' => 'google', 'label' => 'Google Gemini', 'modelPlaceholder' => 'gemini-3-pro', 'needsBaseUrl' => false],
    ['value' => 'openai_compatible', 'label' => 'Kompatibel OpenAI / custom', 'modelPlaceholder' => 'nama-model', 'needsBaseUrl' => true],
];

function requires_base_url(string $provider): bool
{
    return $provider === 'openai_compatible';
}

/** base_url: wajib https:// (http://localhost hanya saat debug). */
function is_valid_base_url(string $url): bool
{
    $u = parse_url($url);
    if (!$u || empty($u['scheme']) || empty($u['host'])) return false;
    if ($u['scheme'] === 'https') return true;
    return config('debug') && $u['scheme'] === 'http' && in_array($u['host'], ['localhost', '127.0.0.1'], true);
}

/**
 * Pengaturan AI dari header request (diisi app.js dari localStorage), atau null kalau belum lengkap.
 * ['provider','model','apiKey','baseUrl']
 */
function request_llm_settings(bool $requireModel = true): ?array
{
    $hdr = fn(string $name) => trim((string) ($_SERVER['HTTP_X_LLM_' . $name] ?? ''));
    $provider = $hdr('PROVIDER');
    $model = $hdr('MODEL');
    $apiKey = $hdr('KEY');
    $baseUrl = $hdr('BASE_URL');
    if (!in_array($provider, PROVIDERS, true) || ($requireModel && $model === '') || $apiKey === '') return null;
    if (strlen($model) > 200 || strlen($apiKey) > 500 || strlen($baseUrl) > 500) return null;
    if (requires_base_url($provider)) {
        if (!is_valid_base_url($baseUrl)) return null;
    } else {
        $baseUrl = '';
    }
    return ['provider' => $provider, 'model' => $model, 'apiKey' => $apiKey, 'baseUrl' => $baseUrl ?: null];
}
