<?php
// Salin file ini menjadi config.php lalu isi nilainya. config.php tidak ikut repo (berisi rahasia).
return [
    // Database MySQL (di InfinityFree: lihat "MySQL Databases" di control panel).
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'ielts_rater',
        'user' => 'root',
        'pass' => '',
    ],

    // Email admin (huruf kecil). Admin bisa membuka Pengaturan dan mengubah semua soal.
    'admin_emails' => ['kamu@gmail.com'],

    // 64 karakter hex untuk mengenkripsi API key AI di database.
    // Buat sekali, misalnya di https://www.random.org/bytes/ (32 byte, hex) — jangan diganti setelah dipakai.
    'encryption_key' => '',

    // Folder upload gambar soal. Default: htdocs/storage/uploads (sudah dilindungi .htaccess).
    'upload_dir' => __DIR__ . '/storage/uploads',

    // Cadangan kalau Pengaturan AI di halaman admin belum diisi. Boleh dikosongkan.
    'llm' => [
        'provider' => '', // anthropic | openai | google | openai_compatible
        'model' => '',
        'api_key' => '',
        'base_url' => '',
    ],

    // Batas tunggu satu jawaban AI (detik). 55 aman untuk InfinityFree; pilih model yang cepat (mis. Gemini Flash).
    'llm_timeout' => 55,

    // true = pakai jawaban contoh (tanpa memanggil AI), hanya untuk uji coba lokal.
    'llm_mock' => false,

    // true = tampilkan detail error PHP (hanya untuk lokal).
    'debug' => false,
];
