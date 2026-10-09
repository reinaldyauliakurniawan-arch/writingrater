# Panduan pasang di InfinityFree (versi PHP)

Aplikasi versi PHP ada di folder `htdocs/`. Isi folder itu yang diunggah ke hosting.
Kebutuhan: PHP 8.1–8.3 (ekstensi curl, openssl, pdo_mysql, mbstring) dan MySQL/MariaDB. Semuanya tersedia di InfinityFree.

## 1. Siapkan hosting dan database

1. Buat akun dan hosting di InfinityFree, lalu pasang domain/subdomain.
2. Di control panel: **MySQL Databases** → buat database baru. Catat **MySQL Hostname** (mis. `sql123.infinityfree.com`),
   **Database Name** (mis. `if0_12345678_ielts`), **Username** (mis. `if0_12345678`), dan **Password** (sama dengan password akun hosting, lihat di halaman akun).
3. Aktifkan **SSL** gratis untuk domain dan tunggu sampai aktif.
4. Kalau ada pilihan versi PHP, pilih 8.3 (atau 8.1/8.2).

## 2. Isi config.php

Di komputer, salin `htdocs/config.sample.php` menjadi `htdocs/config.php`, lalu isi:

- `db`: host, name, user, pass dari langkah 1 (`port` biarkan 3306).
- `admin_emails`: email akun yang akan jadi admin (huruf kecil).
- `encryption_key`: 64 karakter hex. Buat sekali, misalnya di <https://www.random.org/bytes/> (32 byte, format hex, hapus spasinya).
  **Jangan diganti setelah dipakai**, karena API key AI yang tersimpan tidak akan bisa dibaca lagi.
- Bagian lain biarkan default. `llm_mock` dan `debug` harus `false`.

## 3. Unggah file

Pakai FileZilla (FTP, data login FTP ada di control panel) atau File Manager InfinityFree.
Unggah **semua isi** folder `htdocs/` ke folder `htdocs` di hosting, termasuk:

- `index.php`, `config.php`, `.htaccess` (file tersembunyi; di FileZilla aktifkan *Server → Force showing hidden files*)
- folder `app/`, `assets/`, `storage/` (beserta file `.htaccess` di dalamnya)

Folder `app/` dan `storage/` otomatis tertutup dari akses langsung lewat `.htaccess`.

## 4. Jalankan instalasi

1. Buka `https://domainkamu/install`.
2. Pastikan status "Koneksi database: berhasil", lalu klik **Pasang / perbarui database**.
   Langkah ini membuat tabel dan mengimpor 40 soal Cambridge 15–19 beserta gambarnya.
3. Buka `https://domainkamu/register` dan daftar memakai email admin dari `config.php`.
4. Masuk ke **Pengaturan**, isi provider, model, dan API key AI, klik **Tes koneksi**, lalu **Simpan**.

Halaman `/install` aman dibuka lagi kapan saja (misalnya setelah update aplikasi). Setelah ada pengguna, hanya admin yang bisa menjalankannya.

## Memilih model AI

InfinityFree membatasi lama satu permintaan. Karena itu setiap tahap AI (baca grafik, cek data, nilai, tulis ulang)
dijalankan sebagai permintaan terpisah, dan satu jawaban AI ditunggu paling lama 55 detik (`llm_timeout` di config).

- Pakai model yang **cepat**, misalnya Gemini Flash, Claude Haiku/Sonnet, atau GPT mini.
- Model raksasa yang lambat (contoh: `nvidia/nemotron-3-ultra-550b` lewat NVIDIA) tidak menjawab penilaian
  dalam 150 detik saat diuji, jadi tidak cocok dipakai.
- Model teks saja tetap bisa dipakai. Task 1 dikerjakan lewat "Isi data manual" atau soal dari database soal.

## Update aplikasi

Unggah ulang isi folder `htdocs/` (kecuali `config.php` dan isi `storage/uploads/`). Kolom database baru ditambahkan otomatis saat halaman pertama dibuka; kalau ragu, buka `/install` dan klik tombolnya sekali lagi.

## Uji di komputer sendiri

```
php -S localhost:8000 -t htdocs scripts/php-router.php
```

Lalu buka <http://localhost:8000>. `config.php` lokal bisa memakai database MySQL Laragon.

## Menambah soal bawaan

Soal yang ditambahkan lewat app tersimpan di database. Supaya ikut terpasang otomatis di hosting lain,
jalankan `php scripts/export-questions.php` di komputer (memakai `htdocs/config.php`). Perintah ini menulis ulang
`htdocs/app/data/questions/`. Setelah itu unggah folder tersebut lalu buka `/install`.
