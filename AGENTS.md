# IELTS Writing Rater — versi PHP

Aplikasi ada di `htdocs/` (PHP 8.1–8.3 tanpa framework, MySQL/MariaDB, JavaScript biasa tanpa build) dan ditujukan untuk shared hosting InfinityFree.

- Panduan pasang: `PANDUAN-INFINITYFREE.md`. Uji lokal: `php -S localhost:8000 -t htdocs scripts/php-router.php`.
- Konfigurasi di `htdocs/config.php` (salinan `config.sample.php`, tidak ikut repo).
- Setiap request menjalankan paling banyak satu tahap AI (lihat `htdocs/app/llm/pipeline.php`); progres disimpan di `submission.pendingState` dan browser memanggil ulang sampai selesai. Jangan menggabungkan beberapa panggilan AI dalam satu request — batas waktu hosting.
- Nama tabel huruf kecil supaya sama di Windows dan Linux. Skema: `htdocs/app/schema.sql`, dipasang lewat halaman `/install`.
- API key AI milik tiap pengguna disimpan di localStorage browser (`llmSettings`) dan dikirim lewat header `X-LLM-Provider/Model/Key/Base-Url` hanya ke endpoint AI (`htdocs/assets/app.js` → `api()`); server membacanya di `request_llm_settings()` (`htdocs/app/lib/settings.php`). Jangan menyimpan atau mencatat API key di server.
- Fitur Speaking: lihat `PRD Speaking.md`. Transkripsi Whisper berjalan di browser (`htdocs/assets/whisper-worker.js`); audio tidak pernah dikirim ke server. AI hanya menilai LR/GRA (`htdocs/app/llm/speaking.php`); FC/Pronunciation dinilai examiner. Bank soal `htdocs/app/data/speaking/sets.json`, descriptor `htdocs/app/kb/speaking_descriptors.json`.
- Prompt AI, descriptor (`htdocs/app/kb/`), dan aturan skor mengikuti spec; naikkan `PROMPT_VERSION` di `htdocs/app/bootstrap.php` setiap prompt/KB berubah.
