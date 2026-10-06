import "server-only";
import { Prisma, type Submission } from "@prisma/client";

export type IdContext = { params: Promise<{ id: string }> };

/** Data reset status saat soal/gambar berubah ketika extracted/confirmed (bagian 3 & 7.1). */
export function resetExtractionIfNeeded(sub: Submission) {
  if (sub.status === "extracted" || sub.status === "confirmed") {
    return { status: "draft" as const, extractedData: Prisma.DbNull, extractionUncertain: Prisma.DbNull };
  }
  return {};
}
