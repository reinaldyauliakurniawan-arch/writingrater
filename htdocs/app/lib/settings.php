<?php
declare(strict_types=1);

require_once APP_DIR . '/lib/crypto.php';

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
 * Pengaturan aktif: appsetting (key terisi) -> config.php llm -> null.
 * ['llm' => ['provider','model','apiKey','baseUrl']|null, 'source' => database|config|none, 'row' => array|null]
 */
function get_settings(bool $fresh = false): array
{
    static $cache = null;
    if ($cache && !$fresh) return $cache;
    $row = db_one('SELECT * FROM `appsetting` WHERE id = 1');
    if ($row && $row['apiKeyEncrypted']) {
        return $cache = [
            'llm' => [
                'provider' => $row['provider'],
                'model' => $row['model'],
                'apiKey' => decrypt_secret($row['apiKeyEncrypted']),
                'baseUrl' => $row['baseUrl'],
            ],
            'source' => 'database',
            'row' => $row,
        ];
    }
    $c = (array) config('llm');
    $p = $c['provider'] ?? '';
    $ok = in_array($p, PROVIDERS, true) && !empty($c['model']) && !empty($c['api_key'])
        && (!requires_base_url($p) || !empty($c['base_url']));
    $llm = $ok ? ['provider' => $p, 'model' => $c['model'], 'apiKey' => $c['api_key'], 'baseUrl' => $c['base_url'] ?: null] : null;
    return $cache = ['llm' => $llm, 'source' => $llm ? 'config' : 'none', 'row' => $row];
}

function public_settings(): array
{
    $s = get_settings();
    $row = $s['row'];
    $active = $s['source'] === 'database' ? $row : null;
    return [
        'provider' => $active['provider'] ?? $s['llm']['provider'] ?? $row['provider'] ?? null,
        'model' => $active['model'] ?? $s['llm']['model'] ?? $row['model'] ?? null,
        'base_url' => $active['baseUrl'] ?? $s['llm']['baseUrl'] ?? $row['baseUrl'] ?? null,
        'api_key_last4' => $row['apiKeyLast4'] ?? null,
        'has_api_key' => !empty($row['apiKeyEncrypted']),
        'last_test_ok' => isset($row['lastTestOk']) ? (bool) $row['lastTestOk'] : null,
        'last_test_at' => iso($row['lastTestAt'] ?? null),
        'updated_at' => iso($row['updatedAt'] ?? null),
        'updated_at_text' => format_date($row['updatedAt'] ?? null),
        'updated_by' => $row['updatedBy'] ?? null,
        'source' => $s['source'],
    ];
}

function stored_api_key(): ?string
{
    $row = get_settings()['row'];
    return !empty($row['apiKeyEncrypted']) ? decrypt_secret($row['apiKeyEncrypted']) : null;
}

function save_settings(string $provider, string $model, ?string $baseUrl, ?string $apiKey, ?bool $testOk, string $adminEmail): void
{
    $data = [
        'provider' => $provider,
        'model' => $model,
        'baseUrl' => $baseUrl,
        'updatedBy' => $adminEmail,
        'updatedAt' => now_utc(),
    ];
    if ($apiKey !== null) {
        $data['apiKeyEncrypted'] = encrypt_secret($apiKey);
        $data['apiKeyLast4'] = substr($apiKey, -4);
    }
    if ($testOk !== null) {
        $data['lastTestOk'] = $testOk ? 1 : 0;
        $data['lastTestAt'] = now_utc();
    }
    if (db_one('SELECT id FROM `appsetting` WHERE id = 1')) {
        db_update('appsetting', $data, ['id' => 1]);
    } else {
        db_insert('appsetting', ['id' => 1] + $data);
    }
    get_settings(true);
}
