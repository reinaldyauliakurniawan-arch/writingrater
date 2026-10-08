// Kalibrasi (bagian 9, M7): nilai semua calibration/*.json dengan factcheck + grade + aturan bagian 4,
// tanpa menyimpan ke database dan tanpa batas harian, lalu tulis calibration/report-{YYYYMMDD-HHmm}.md.
// Jalankan: npm run calibrate
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ROOT = process.cwd();
const CAL_DIR = path.join(ROOT, "calibration");
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const Bands = z.object({
  task: z.number().int().min(0).max(9),
  cc: z.number().int().min(0).max(9),
  lr: z.number().int().min(0).max(9),
  gra: z.number().int().min(0).max(9),
});

const CalibrationItem = z.object({
  id: z.string().min(1),
  task_type: z.enum(["task1_academic", "task2"]),
  prompt_text: z.string(),
  image_file: z.string().nullable(),
  extracted_data: z.unknown().nullable(),
  essay_text: z.string(),
  human: Bands,
});
type CalibrationItem = z.infer<typeof CalibrationItem>;

const KEYS = ["task", "cc", "lr", "gra"] as const;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

type Row =
  | { id: string; task: string; human: z.infer<typeof Bands>; humanBand: number; ai: Record<(typeof KEYS)[number], number>; aiBand: number; model: string | null }
  | { id: string; task: string; error: string };

function stamp(d = new Date()) {
  // Waktu Asia/Jakarta (UTC+7) untuk nama file laporan.
  const j = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}-${p(j.getUTCHours())}${p(j.getUTCMinutes())}`;
}

const fmt = (n: number) => n.toFixed(1);
const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);

async function main() {
  // Import dinamis supaya .env.local sudah dimuat sebelum modul server membaca env.
  const { gradeCore } = await import("../src/lib/llm/pipeline");
  const { ExtractedData } = await import("../src/lib/llm/schemas");
  const { taskBand } = await import("../src/lib/scoring/rounding");
  const { prisma } = await import("../src/lib/db");

  const files = fs.existsSync(CAL_DIR)
    ? fs.readdirSync(CAL_DIR).filter((f) => f.toLowerCase().endsWith(".json")).sort()
    : [];
  if (files.length === 0) {
    console.error("Tidak ada file calibration/*.json.");
    process.exitCode = 1;
    return;
  }

  const rows: Row[] = [];
  for (const file of files) {
    let item: CalibrationItem;
    try {
      item = CalibrationItem.parse(JSON.parse(fs.readFileSync(path.join(CAL_DIR, file), "utf8")));
    } catch (e) {
      rows.push({ id: file, task: "-", error: `file tidak valid: ${(e as Error).message.split("\n")[0]}` });
      continue;
    }
    process.stdout.write(`Menilai ${item.id} (${item.task_type})… `);
    try {
      let image: { data: Uint8Array; mimeType: string } | null = null;
      let extracted = null;
      if (item.task_type === "task1_academic") {
        if (!item.image_file || !item.extracted_data) throw new Error("Task 1 wajib mengisi image_file dan extracted_data");
        extracted = ExtractedData.parse(item.extracted_data);
      }
      if (item.image_file) {
        const imgPath = path.resolve(CAL_DIR, item.image_file);
        const mimeType = MIME[path.extname(imgPath).toLowerCase()];
        if (!mimeType) throw new Error(`jenis gambar tidak didukung: ${item.image_file}`);
        image = { data: new Uint8Array(fs.readFileSync(imgPath)), mimeType };
      }
      const r = await gradeCore(
        { task: item.task_type, promptText: item.prompt_text, image, extractedData: extracted, essayText: item.essay_text },
        null,
      );
      const human = taskBand([item.human.task, item.human.cc, item.human.lr, item.human.gra]);
      rows.push({ id: item.id, task: item.task_type, human: item.human, humanBand: human.band, ai: r.bands, aiBand: r.taskBand, model: r.model });
      console.log(`AI ${fmt(r.taskBand)} / manusia ${fmt(human.band)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ id: item.id, task: item.task_type, error: msg });
      console.log(`gagal: ${msg}`);
    }
  }
  await prisma.$disconnect().catch(() => {});

  const ok = rows.filter((r): r is Extract<Row, { ai: unknown }> => "ai" in r);
  const mae = (f: (r: (typeof ok)[number]) => number) =>
    ok.length === 0 ? "-" : (ok.reduce((s, r) => s + Math.abs(f(r)), 0) / ok.length).toFixed(2);
  const exact = ok.filter((r) => r.aiBand === r.humanBand).length;
  const within = ok.filter((r) => Math.abs(r.aiBand - r.humanBand) <= 0.5).length;

  const model = [...new Set(ok.map((r) => r.model).filter(Boolean))].join(", ") || "-";
  const lines = [
    `# Laporan kalibrasi ${stamp()}`,
    "",
    `Model: ${model} · Esai: ${rows.length} · Berhasil dinilai: ${ok.length}`,
    "",
    "## Per esai",
    "",
    "| Esai | Task | TA/TR manusia | TA/TR AI | CC manusia | CC AI | LR manusia | LR AI | GRA manusia | GRA AI | Task band manusia | Task band AI | Selisih |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) =>
      "error" in r
        ? `| ${r.id} | ${r.task} | gagal: ${r.error.replace(/\|/g, "/")} |  |  |  |  |  |  |  |  |  |  |`
        : `| ${r.id} | ${r.task} | ${KEYS.map((k) => `${r.human[k]} | ${r.ai[k]}`).join(" | ")} | ${fmt(r.humanBand)} | ${fmt(r.aiBand)} | ${(r.aiBand - r.humanBand >= 0 ? "+" : "") + fmt(r.aiBand - r.humanBand)} |`,
    ),
    "",
    "## Ringkasan",
    "",
    "| Ukuran | Nilai |",
    "| --- | --- |",
    `| MAE Task Achievement/Response | ${mae((r) => r.ai.task - r.human.task)} |`,
    `| MAE Coherence & Cohesion | ${mae((r) => r.ai.cc - r.human.cc)} |`,
    `| MAE Lexical Resource | ${mae((r) => r.ai.lr - r.human.lr)} |`,
    `| MAE Grammatical Range & Accuracy | ${mae((r) => r.ai.gra - r.human.gra)} |`,
    `| MAE task band | ${mae((r) => r.aiBand - r.humanBand)} |`,
    `| Task band sama persis | ${pct(exact, ok.length)} (${exact}/${ok.length}) |`,
    `| Selisih task band ≤ 0.5 | ${pct(within, ok.length)} (${within}/${ok.length}) |`,
    "",
  ];
  const out = path.join(CAL_DIR, `report-${stamp()}.md`);
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`Laporan: ${path.relative(ROOT, out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
