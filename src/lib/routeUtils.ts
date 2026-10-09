import "server-only";
import { Prisma, type Submission } from "@prisma/client";

export type IdContext = { params: Promise<{ id: string }> };

/**
 * Data reset saat soal/gambar berubah: status kembali draft kalau extracted/confirmed (bagian 3 & 7.1),
 * dan tautan ke database soal dilepas karena soalnya sudah bukan soal di database.
 */
export function resetExtractionIfNeeded(sub: Submission): Prisma.SubmissionUpdateInput {
  const unlink = sub.questionId ? { question: { disconnect: true } } : {};
  if (sub.status === "extracted" || sub.status === "confirmed") {
    return { status: "draft", extractedData: Prisma.DbNull, extractionUncertain: Prisma.DbNull, ...unlink };
  }
  return unlink;
}
