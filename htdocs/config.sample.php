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

    // Email admin (huruf kecil). Admin bisa mengubah semua soal dan menjalankan /install.
    // API key AI TIDAK diisi di sini: setiap pengguna mengisi key sendiri di menu Pengaturan (tersimpan di browsernya).
    'admin_emails' => ['kamu@gmail.com'],

    // Folder upload gambar soal. Default: htdocs/storage/uploads (sudah dilindungi .htaccess).
    'upload_dir' => __DIR__ . '/storage/uploads',

    // Batas tunggu satu jawaban AI (detik). 55 aman untuk InfinityFree; pilih model yang cepat (mis. Gemini Flash).
    'llm_timeout' => 55,

    // true = pakai jawaban contoh (tanpa memanggil AI), hanya untuk uji coba lokal.
    'llm_mock' => false,

    // true = tampilkan detail error PHP (hanya untuk lokal).
    'debug' => false,
];
