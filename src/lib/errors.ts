import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const ERRORS = {
  UNAUTHORIZED: { status: 401, message: "Silakan login dulu." },
  NOT_FOUND: { status: 404, message: "Data tidak ditemukan." },
  VALIDATION_ERROR: { status: 400, message: "Input tidak valid." },
  WRONG_TASK_TYPE: { status: 400, message: "Aksi ini hanya untuk Task 1." },
  IMAGE_REQUIRED: { status: 400, message: "Task 1 wajib menyertakan gambar soal." },
  PROMPT_REQUIRED: { status: 400, message: "Isi soal dulu (teks atau gambar)." },
  ESSAY_EMPTY: { status: 400, message: "Jawaban masih kosong." },
  EXTRACTION_NOT_CONFIRMED: { status: 409, message: "Konfirmasi data grafik dulu sebelum menilai." },
  SUBMISSION_LOCKED: {
    status: 409,
    message: 'Submission yang sudah dinilai tidak bisa diubah. Gunakan "Revisi & nilai ulang".',
  },
  SESSION_SLOT_TAKEN: { status: 409, message: "Task ini sudah ada di sesi." },
  POLISH_NOT_AVAILABLE: { status: 409, message: "Versi polished tidak tersedia untuk jawaban ini." },
  DAILY_LIMIT_REACHED: { status: 429, message: "Batas harian tercapai. Coba lagi besok." },
  LLM_FAILED: { status: 502, message: "Penilaian gagal diproses. Coba lagi sebentar." },
  EMAIL_TAKEN: { status: 409, message: "Email ini sudah terdaftar." },
  INVALID_IMAGE: { status: 400, message: "Gambar harus PNG, JPG, atau WEBP dan maksimal 5 MB." },
  FORBIDDEN: { status: 403, message: "Halaman ini khusus admin." },
  LLM_NOT_CONFIGURED: { status: 503, message: "Layanan penilaian belum dikonfigurasi. Hubungi admin." },
  SETTINGS_TEST_FAILED: {
    status: 400,
    message: "Tes koneksi gagal: {detail}. Pengaturan tidak disimpan.",
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public detail?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(code: ErrorCode, detail?: string) {
  const def = ERRORS[code];
  const message = def.message.replace("{detail}", (detail ?? "").replace(/[.\s]+$/, ""));
  return NextResponse.json({ error: { code, message } }, { status: def.status });
}

/** Bungkus handler route: AppError dan ZodError diubah ke respons error standar. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AppError) return fail(e.code, e.detail);
      if (e instanceof ZodError) return fail("VALIDATION_ERROR");
      console.error(e);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan. Coba lagi." } },
        { status: 500 },
      );
    }
  };
}

/** Baca body JSON; body rusak/kosong dianggap {} lalu divalidasi zod oleh pemanggil. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
