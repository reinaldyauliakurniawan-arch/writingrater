# IELTS Writing Rater — versi PHP

Aplikasi ada di `htdocs/` (PHP 8.1–8.3 tanpa framework, MySQL/MariaDB, JavaScript biasa tanpa build) dan ditujukan untuk shared hosting InfinityFree.

- Panduan pasang: `PANDUAN-INFINITYFREE.md`. Uji lokal: `php -S localhost:8000 -t htdocs scripts/php-router.php`.
- Konfigurasi di `htdocs/config.php` (salinan `config.sample.php`, tidak ikut repo).
- Setiap request menjalankan paling banyak satu tahap AI (lihat `htdocs/app/llm/pipeline.php`); progres disimpan di `submission.pendingState` dan browser memanggil ulang sampai selesai. Jangan menggabungkan beberapa panggilan AI dalam satu request — batas waktu hosting.
- Nama tabel huruf kecil supaya sama di Windows dan Linux. Skema: `htdocs/app/schema.sql`, dipasang lewat halaman `/install`.
- Prompt AI, descriptor (`htdocs/app/kb/`), dan aturan skor mengikuti spec; naikkan `PROMPT_VERSION` di `htdocs/app/bootstrap.php` setiap prompt/KB berubah.
