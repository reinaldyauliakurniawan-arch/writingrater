<?php
declare(strict_types=1);

const ERRORS = [
    'UNAUTHORIZED' => [401, 'Silakan login dulu.'],
    'NOT_FOUND' => [404, 'Data tidak ditemukan.'],
    'VALIDATION_ERROR' => [400, 'Input tidak valid.'],
    'CSRF' => [403, 'Sesi halaman kedaluwarsa. Muat ulang halaman lalu coba lagi.'],
    'WRONG_TASK_TYPE' => [400, 'Aksi ini hanya untuk Task 1.'],
    'IMAGE_REQUIRED' => [400, 'Task 1 wajib menyertakan gambar soal.'],
    'PROMPT_REQUIRED' => [400, 'Isi soal dulu (teks atau gambar).'],
    'ESSAY_EMPTY' => [400, 'Jawaban masih kosong.'],
    'EXTRACTION_NOT_CONFIRMED' => [409, 'Konfirmasi data grafik dulu sebelum menilai.'],
    'SUBMISSION_LOCKED' => [409, 'Submission yang sudah dinilai tidak bisa diubah. Gunakan "Revisi & nilai ulang".'],
    'SESSION_SLOT_TAKEN' => [409, 'Task ini sudah ada di sesi.'],
    'POLISH_NOT_AVAILABLE' => [409, 'Versi polished tidak tersedia untuk jawaban ini.'],
    'LLM_FAILED' => [502, 'Penilaian gagal diproses. Coba lagi sebentar.'],
    'LLM_TIMEOUT' => [504, 'Model AI terlalu lama menjawab. Coba lagi; kalau terus terjadi, admin perlu mengganti ke model yang lebih cepat (mis. Gemini Flash) di halaman Pengaturan.'],
    'LLM_QUOTA_EXCEEDED' => [429, 'Kuota atau limit API AI sudah habis. Ganti API key di halaman Pengaturan, lalu coba lagi.'],
    'LLM_KEY_INVALID' => [502, 'API key AI ditolak (tidak valid atau sudah dicabut). Ganti API key di halaman Pengaturan.'],
    'LLM_NO_VISION' => [400, 'Model AI yang dipakai tidak bisa membaca gambar. Pakai tombol "Isi data manual", pilih soal dari database soal, atau ganti ke model yang mendukung gambar di halaman Pengaturan.'],
    'QUESTION_NAME_TAKEN' => [409, 'Nama soal ini sudah ada di database soal. Pakai nama lain.'],
    'QUESTION_NOT_READY' => [409, 'Konfirmasi data grafik dulu sebelum menyimpan soal ke database.'],
    'QUESTION_FORBIDDEN' => [403, 'Hanya pembuat soal atau admin yang bisa mengubah soal ini.'],
    'EMAIL_TAKEN' => [409, 'Email ini sudah terdaftar.'],
    'LOGIN_FAILED' => [401, 'Email atau password salah.'],
    'INVALID_IMAGE' => [400, 'Gambar harus PNG, JPG, atau WEBP dan maksimal 5 MB.'],
    'FORBIDDEN' => [403, 'Halaman ini khusus admin.'],
    'LLM_NOT_CONFIGURED' => [503, 'Layanan penilaian belum dikonfigurasi. Hubungi admin.'],
    'SETTINGS_TEST_FAILED' => [400, 'Tes koneksi gagal: {detail}. Pengaturan tidak disimpan.'],
];

final class AppError extends RuntimeException
{
    public function __construct(public readonly string $errorCode, public readonly ?string $detail = null)
    {
        parent::__construct($errorCode);
    }

    public function status(): int
    {
        return ERRORS[$this->errorCode][0] ?? 500;
    }

    public function userMessage(): string
    {
        $msg = ERRORS[$this->errorCode][1] ?? 'Terjadi kesalahan. Coba lagi.';
        return str_replace('{detail}', rtrim($this->detail ?? '', ". \t\n"), $msg);
    }
}
