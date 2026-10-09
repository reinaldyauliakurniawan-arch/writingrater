<?php
declare(strict_types=1);

// AES-256-GCM, IV 12 byte. Format: "<iv_b64>:<authTag_b64>:<ciphertext_b64>" (sama dengan versi Node).

function crypto_key(): string
{
    $hex = (string) config('encryption_key');
    if (!preg_match('/^[0-9a-fA-F]{64}$/', $hex)) {
        throw new RuntimeException('encryption_key di config.php harus 64 karakter hex.');
    }
    return hex2bin($hex);
}

function encrypt_secret(string $plain): string
{
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', crypto_key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($ct === false) throw new RuntimeException('Enkripsi gagal.');
    return base64_encode($iv) . ':' . base64_encode($tag) . ':' . base64_encode($ct);
}

function decrypt_secret(string $enc): string
{
    $parts = explode(':', $enc);
    if (count($parts) !== 3) throw new RuntimeException('Format secret terenkripsi tidak valid.');
    [$iv, $tag, $ct] = array_map('base64_decode', $parts);
    $plain = openssl_decrypt($ct, 'aes-256-gcm', crypto_key(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($plain === false) throw new RuntimeException('Dekripsi gagal (encryption_key berbeda?).');
    return $plain;
}
