import { z } from "zod";

// ---- 6.2 Extract ----
export const ExtractedData = z.object({
  chart_type: z.enum(["line", "bar", "pie", "table", "process", "map", "mixed", "other"]),
  title: z.string(),
  units: z.string(), // "%", "£ million", "" jika tidak ada
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.string()).min(1), // mis. tahun / kategori sumbu X
      rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })),
    }),
  ), // values.length === columns.length
  process_steps: z.array(z.string()), // diagram proses, selain itu []
  map_changes: z.array(z.string()), // peta, selain itu []
  notes: z.array(z.string()),
});
export type ExtractedData = z.infer<typeof ExtractedData>;

export const CHART_TYPE_LABELS: Record<ExtractedData["chart_type"], string> = {
  line: "Grafik garis",
  bar: "Grafik batang",
  pie: "Diagram lingkaran",
  table: "Tabel",
  process: "Diagram proses",
  map: "Peta",
  mixed: "Campuran",
  other: "Lainnya",
};

/** Data kosong untuk diisi manual (tanpa membaca gambar). */
export function emptyExtractedData(): ExtractedData {
  return {
    chart_type: "other",
    title: "",
    units: "",
    tables: [{ name: "Data", columns: ["", ""], rows: [{ label: "", values: ["", ""] }] }],
    process_steps: [],
    map_changes: [],
    notes: [],
  };
}

/** Validasi tambahan: setiap baris punya jumlah nilai sama dengan jumlah kolom. */
export function checkExtractedData(d: ExtractedData): string | null {
  for (const t of d.tables) {
    for (const r of t.rows) {
      if (r.values.length !== t.columns.length) {
        return `table "${t.name}" row "${r.label}" has ${r.values.length} values for ${t.columns.length} columns`;
      }
    }
  }
  return null;
}

// ---- 6.3 Factcheck ----
export const FactCheck = z.object({
  fact_errors: z.array(
    z.object({
      essay_quote: z.string(), // kutipan persis dari esai, maks. 30 kata
      issue: z.string(), // apa yang salah
      correct_info: z.string(), // yang benar menurut data
      severity: z.enum(["key_feature", "detail"]),
    }),
  ),
  overview_present: z.boolean(),
  overview_quote: z.string().nullable(),
  data_support_present: z.boolean(), // ada angka/data yang dikutip?
});
export type FactCheck = z.infer<typeof FactCheck>;

// ---- 6.4 Grade ----
export const CriterionResult = z.object({
  evidence: z.array(z.string()).min(1).max(6), // kutipan pendek dari esai
  band: z.number().int().min(0).max(9),
  feedback: z.string(), // 80–150 kata, Inggris
  tip: z.string().nullable(), // maks. 15 kata atau null
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const GradeOutput = z.object({
  language_check: z.enum(["english", "not_english"]),
  criteria: z.object({ task: CriterionResult, cc: CriterionResult, lr: CriterionResult, gra: CriterionResult }),
  ceilings_triggered: z.array(z.string()),
});
export type GradeOutput = z.infer<typeof GradeOutput>;

export const FEEDBACK_MIN_WORDS = 60;
export const FEEDBACK_MAX_WORDS = 180;
export const TIP_MAX_WORDS = 20;

const plainWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Validasi tambahan 6.4: feedback 60–180 kata, tip ≤ 20 kata. Gagal = output invalid (retry). */
export function checkGradeOutput(g: GradeOutput): string | null {
  // Esai bukan Inggris diganti template BAND0_NOT_ENGLISH, jadi panjang feedback tidak relevan.
  if (g.language_check === "not_english") return null;
  for (const [k, c] of Object.entries(g.criteria)) {
    const n = plainWords(c.feedback);
    if (n < FEEDBACK_MIN_WORDS || n > FEEDBACK_MAX_WORDS) return `${k}.feedback has ${n} words`;
    if (c.tip !== null && plainWords(c.tip) > TIP_MAX_WORDS) return `${k}.tip has ${plainWords(c.tip)} words`;
  }
  return null;
}

// ---- 6.5 Polish ----
export const CORRECTION_TYPES = ["content", "data", "cohesion", "vocab", "grammar"] as const;
const CorrectionItem = z.object({
  quote: z.string().min(1), // kutipan persis dari esai asli, maks. 12 kata
  issue: z.string(), // apa yang salah
  correction: z.string(), // versi yang benar
});
export type Correction = z.infer<typeof CorrectionItem> & { type: (typeof CORRECTION_TYPES)[number] };

// Satu daftar per kriteria supaya model memeriksa keempatnya (satu daftar gabungan cenderung hanya grammar).
const itemList = z.array(CorrectionItem).max(15);
export const PolishOutput = z.object({
  corrections: z.object({ content: itemList, cohesion: itemList, vocab: itemList, grammar: itemList }),
  polished_text: z.string().min(1),
});

/** Daftar per kriteria -> daftar datar bertipe (format simpan di PolishedVersion.corrections). */
export function flattenCorrections(c: PolishOutput["corrections"]): Correction[] {
  return (["content", "cohesion", "vocab", "grammar"] as const).flatMap((type) => c[type].map((i) => ({ ...i, type })));
}
export type PolishOutput = z.infer<typeof PolishOutput>;

// ---- 6.6 Tes koneksi ----
export const ConnectionTestOutput = z.object({ numbers: z.array(z.number()) });
