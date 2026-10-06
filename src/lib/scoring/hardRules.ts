import { BAND1_MAX_WORDS, MIN_WORDS, SEVERE_UNDERLENGTH_RATIO } from "../config";
import { mapCriteria, type Bands, type CriterionKey, type TaskType } from "./types";

export const BAND1_SHORT =
  "Responses of 20 words or fewer are rated at Band 1. Write a complete response of at least {MIN} words so that every criterion can be assessed.";
export const BAND0_NOT_ENGLISH =
  "This response is not written in English, so it cannot be rated. Please submit your answer in English.";

export type TemplateCriterion = { band: number; feedback: string; tip: null };

export type HardRuleResult =
  | { kind: "reject"; code: "ESSAY_EMPTY" }
  | {
      kind: "fixed";
      template: "BAND1_SHORT" | "BAND0_NOT_ENGLISH";
      criteria: Record<CriterionKey, TemplateCriterion>;
    }
  | { kind: "llm" };

export function lengthFlags(task: TaskType, counted: number) {
  const min = MIN_WORDS[task];
  return {
    underlength: counted < min,
    severeUnderlength: counted < Math.floor(min * SEVERE_UNDERLENGTH_RATIO),
  };
}

function fixed(band: number, feedback: string): Record<CriterionKey, TemplateCriterion> {
  return mapCriteria(() => ({ band, feedback, tip: null }));
}

/**
 * Bagian 4.2. Panggil sebelum LLM tanpa languageCheck (baris 1–2),
 * dan sesudah LLM dengan languageCheck dari output grade (baris 3).
 */
export function applyHardRules(input: {
  task: TaskType;
  counted: number;
  languageCheck?: "english" | "not_english";
}): HardRuleResult {
  if (input.counted === 0) return { kind: "reject", code: "ESSAY_EMPTY" };
  if (input.counted <= BAND1_MAX_WORDS) {
    return {
      kind: "fixed",
      template: "BAND1_SHORT",
      criteria: fixed(1, BAND1_SHORT.replace("{MIN}", String(MIN_WORDS[input.task]))),
    };
  }
  if (input.languageCheck === "not_english") {
    return { kind: "fixed", template: "BAND0_NOT_ENGLISH", criteria: fixed(0, BAND0_NOT_ENGLISH) };
  }
  return { kind: "llm" };
}

export function bandsOf(criteria: Record<CriterionKey, { band: number }>): Bands {
  return { task: criteria.task.band, cc: criteria.cc.band, lr: criteria.lr.band, gra: criteria.gra.band };
}
