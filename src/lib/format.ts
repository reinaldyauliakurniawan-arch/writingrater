// Format tampilan (aman untuk browser).
import { APP_TIMEZONE } from "./config";
import type { CriterionView } from "./types";

export const band1 = (b: number) => b.toFixed(1);

/** Teks "Salin hasil" (bagian 8.3), baris kosong di antara blok. */
export function resultCopyText(criteria: CriterionView[], taskBand: number): string {
  const blocks = criteria.map((c) => [c.name, band1(c.band), c.feedback, ...(c.tip ? [c.tip] : [])].join("\n"));
  return [...blocks, `Overall: ${band1(taskBand)}`].join("\n\n");
}

/** Contoh: "6 Okt 2026 14.30" (id-ID, Asia/Jakarta). */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month").replace(".", "")} ${get("year")} ${get("hour")}.${get("minute")}`;
}
