// Konstanta bersama (bagian 4). File ini juga di-import browser (lewat scoring/wordCount);
// pembacaan env ada di src/lib/env.ts (server-only).

export const MIN_WORDS = { task1_academic: 150, task2: 250 } as const;
export const SEVERE_UNDERLENGTH_RATIO = 0.6; // severe jika counted < floor(MIN * 0.6)
export const BAND1_MAX_WORDS = 20; // counted <= 20 -> semua kriteria band 1
export const COPY_MIN_RUN = 5; // minimal 5 kata berurutan dianggap salinan soal
export const TASK2_WEIGHT = 2; // writing = (t1 + 2*t2) / 3
export const PROMPT_VERSION = "v1.1.0"; // naikkan setiap prompt/KB berubah

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const APP_TIMEZONE = "Asia/Jakarta";
export const APP_NAME = "IELTS Writing Rater";

export type TaskTypeKey = keyof typeof MIN_WORDS;
