// Menempatkan koreksi (kutipan dari esai) ke posisi karakter di esai asli. Dipakai server dan browser.

export type CorrectionType = "content" | "data" | "cohesion" | "vocab" | "grammar";

export type CorrectionInput = { quote: string; type: CorrectionType; issue: string; correction: string };

export type CorrectionMark = { start: number; end: number; type: CorrectionType; issue: string; correction: string };

export type Segment = { text: string; mark: CorrectionMark | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex longgar: spasi/baris baru fleksibel, tanda kutip lurus = lengkung, huruf besar/kecil diabaikan. */
function looseRegex(quote: string): RegExp {
  const body = escapeRe(quote.trim())
    .replace(/\s+/g, "\\s+")
    .replace(/['‘’]/g, "['‘’]")
    .replace(/["“”]/g, '["“”]');
  return new RegExp(body, "gi");
}

function findAll(text: string, quote: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = looseRegex(quote);
  for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * Posisi tiap koreksi di esai. Kutipan yang tidak ditemukan atau bertumpuk dengan koreksi lain dibuang.
 * Kalau kutipan muncul beberapa kali: utamakan yang persis sama (termasuk huruf besar), lalu kemunculan
 * pertama setelah koreksi sebelumnya (urutan dari LLM).
 */
export function locateCorrections(essay: string, items: CorrectionInput[]): CorrectionMark[] {
  const placed: CorrectionMark[] = [];
  let cursor = 0;
  for (const item of items) {
    if (!item.quote.trim()) continue;
    const hits = findAll(essay, item.quote);
    const free = hits.filter((h) => !placed.some((p) => h.start < p.end && p.start < h.end));
    const exact = free.filter((h) => essay.slice(h.start, h.end) === item.quote.trim());
    const hit =
      exact.find((h) => h.start >= cursor) ?? exact[0] ?? free.find((h) => h.start >= cursor) ?? free[0];
    if (!hit) continue;
    placed.push({ ...hit, type: item.type, issue: item.issue, correction: item.correction });
    cursor = hit.end;
  }
  return placed.sort((a, b) => a.start - b.start);
}

/** Potong teks jadi segmen biasa dan segmen bertanda (marks sudah urut dan tidak bertumpuk). */
export function toSegments(text: string, marks: CorrectionMark[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos || m.end > text.length) continue;
    if (m.start > pos) out.push({ text: text.slice(pos, m.start), mark: null });
    out.push({ text: text.slice(m.start, m.end), mark: m });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: null });
  return out;
}
