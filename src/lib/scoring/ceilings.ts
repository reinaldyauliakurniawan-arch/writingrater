import ceilingsJson from "../kb/ceilings.json";
import type { Bands, CriterionKey, TaskType } from "./types";

export type Ceiling = { id: string; tasks: TaskType[]; criterion: CriterionKey; cap: number; rule: string };

export const CEILINGS = ceilingsJson as Ceiling[];

export function ceilingsFor(task: TaskType): Ceiling[] {
  return CEILINGS.filter((c) => c.tasks.includes(task));
}

/** Bagian 4.3. Mengembalikan band baru dan id ceiling yang benar-benar diterapkan. */
export function applyCeilings(
  bands: Bands,
  triggeredIds: string[],
  task: TaskType,
): { bands: Bands; applied: string[] } {
  const out: Bands = { ...bands };
  const applied: string[] = [];
  for (const id of triggeredIds) {
    const c = CEILINGS.find((x) => x.id === id);
    if (!c || !c.tasks.includes(task)) {
      console.warn(`[ceilings] id "${id}" tidak dikenal atau tidak berlaku untuk ${task}; diabaikan`);
      continue;
    }
    out[c.criterion] = Math.min(out[c.criterion], c.cap);
    if (!applied.includes(id)) applied.push(id);
  }
  return { bands: out, applied };
}
