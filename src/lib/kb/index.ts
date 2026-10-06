import { z } from "zod";
import descriptorsJson from "./descriptors.json";
import { CRITERIA, CRITERION_NAMES, type TaskType } from "../scoring/types";
import { ceilingsFor } from "../scoring/ceilings";

const BANDS = ["9", "8", "7", "6", "5", "4", "3", "2", "1"] as const;

const BandEntry = z
  .object({ positive: z.array(z.string().min(1)), negative: z.array(z.string().min(1)) })
  .refine((e) => e.positive.length + e.negative.length > 0, "positive dan negative tidak boleh kosong bersama-sama");

const Criterion = z.object(Object.fromEntries(BANDS.map((b) => [b, BandEntry])) as Record<
  (typeof BANDS)[number],
  typeof BandEntry
>);

const TaskDescriptors = z.object({ task: Criterion, cc: Criterion, lr: Criterion, gra: Criterion });

export const DescriptorsSchema = z.object({
  version: z.literal("2023-05"),
  tasks: z.object({ task1_academic: TaskDescriptors, task2: TaskDescriptors }),
  band0: z.string().min(1),
});

export type Descriptors = z.infer<typeof DescriptorsSchema>;

// Divalidasi saat modul dimuat (startup server): file rusak = server gagal start dengan pesan jelas.
export const DESCRIPTORS: Descriptors = DescriptorsSchema.parse(descriptorsJson);

const LIMITING_PREFIX = "[LIMITING] ";

/** Teks descriptor siap tempel ke prompt (bagian 5.2), band 9 ke 1 per kriteria. */
export function getDescriptors(task: TaskType): string {
  return CRITERIA.map((k) => descriptorBlock(task, k, BANDS)).join("\n\n");
}

/** Descriptor satu band untuk keempat kriteria (dipakai prompt polish). */
export function getBandDescriptors(task: TaskType, band: number): string {
  const key = String(band) as (typeof BANDS)[number];
  if (!BANDS.includes(key)) throw new Error(`band ${band} tidak ada di descriptor`);
  return CRITERIA.map((k) => descriptorBlock(task, k, [key])).join("\n\n");
}

function descriptorBlock(task: TaskType, k: (typeof CRITERIA)[number], bands: readonly (typeof BANDS)[number][]) {
  const lines = [`### ${CRITERION_NAMES[task][k]}`];
  for (const b of bands) {
    const e = DESCRIPTORS.tasks[task][k][b];
    lines.push(`Band ${b}:`);
    for (const s of e.positive) lines.push(`- ${s}`);
    for (const s of e.negative) lines.push(`- ${LIMITING_PREFIX}${s}`);
  }
  return lines.join("\n");
}

/** Baris `id: rule` untuk ceiling yang berlaku di task itu. */
export function getCeilingLines(task: TaskType): string {
  return ceilingsFor(task)
    .map((c) => `${c.id}: ${c.rule}`)
    .join("\n");
}
