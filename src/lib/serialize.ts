import "server-only";
import type { PolishedVersion, Question, Submission, WritingSession } from "@prisma/client";
import { MIN_WORDS } from "@/lib/config";
import { polishTarget } from "@/lib/scoring/rounding";
import { CRITERIA, CRITERION_NAMES } from "@/lib/scoring/types";
import type { GradeResult, StoredCriterion } from "@/lib/llm/pipeline";
import type { CriterionKey } from "@/lib/scoring/types";
import type { CriterionView, PolishedView, SubmissionDetail, SubmissionResult } from "@/lib/types";
import type { FactCheck } from "@/lib/llm/schemas";
import { locateCorrections, type CorrectionInput, type CorrectionMark } from "@/lib/corrections";

export function criteriaView(task: Submission["taskType"], criteria: Record<CriterionKey, StoredCriterion>): CriterionView[] {
  return CRITERIA.map((key) => ({
    key,
    name: CRITERION_NAMES[task][key],
    band: criteria[key].band,
    feedback: criteria[key].feedback,
    tip: criteria[key].tip,
  }));
}

export function polishTargetOf(sub: Submission): number | null {
  const gr = sub.gradeResult as unknown as GradeResult | null;
  if (sub.status !== "graded" || sub.taskBand === null || !gr) return null;
  if (gr.language_check !== "english" || (sub.wordCountCounted ?? 0) <= 20) return null;
  return polishTarget(sub.taskBand);
}

export function toSubmissionResult(sub: Submission, session: WritingSession | null): SubmissionResult | null {
  const gr = sub.gradeResult as unknown as GradeResult | null;
  if (sub.status !== "graded" || !gr || sub.taskBand === null || sub.taskBandRaw === null) return null;
  return {
    id: sub.id,
    task_type: sub.taskType,
    status: "graded",
    word_count: {
      total: sub.wordCountTotal ?? 0,
      excluded: sub.wordCountExcluded ?? 0,
      counted: sub.wordCountCounted ?? 0,
      min: MIN_WORDS[sub.taskType],
    },
    criteria: criteriaView(sub.taskType, gr.criteria),
    task_band: sub.taskBand,
    task_band_raw: sub.taskBandRaw,
    fact_errors: sub.taskType === "task1_academic" ? (gr.fact_check?.fact_errors ?? []) : null,
    session: session ? { id: session.id, writing_band: session.writingBand } : null,
    polish_target: polishTargetOf(sub),
  };
}

/** Kesalahan di esai asli: data salah dari fact_check (Task 1) + koreksi content/grammar/vocab dari polish. */
function correctionMarks(sub: Submission, p: PolishedVersion): CorrectionMark[] {
  const essay = sub.essayText ?? "";
  const facts = (sub.factErrors as FactCheck["fact_errors"] | null) ?? [];
  const data: CorrectionInput[] = facts.map((f) => ({
    quote: f.essay_quote,
    type: "data",
    issue: f.issue,
    correction: f.correct_info,
  }));
  const others = (p.corrections as CorrectionInput[] | null) ?? [];
  // Data salah ditempatkan dulu: sudah dicek terhadap data grafik.
  return locateCorrections(essay, [...data, ...others]);
}

export function toPolishedView(sub: Submission, p: PolishedVersion): PolishedView {
  const rescored = p.rescoredResult as unknown as { criteria: Record<CriterionKey, StoredCriterion> };
  return {
    target_band: p.targetBand,
    task_type: sub.taskType,
    original_text: sub.essayText ?? "",
    original_marks: correctionMarks(sub, p),
    has_corrections: p.corrections !== null,
    polished_text: p.polishedText,
    rescored_task_band: p.rescoredTaskBand,
    rescored_criteria: criteriaView(sub.taskType, rescored.criteria),
  };
}

export function toSubmissionDetail(
  sub: Submission & { polished: PolishedVersion | null; question?: Pick<Question, "id" | "name"> | null },
  session: WritingSession | null,
): SubmissionDetail {
  return {
    id: sub.id,
    task_type: sub.taskType,
    status: sub.status,
    session_id: sub.sessionId,
    prompt_text: sub.promptText,
    prompt_image_url: sub.promptImagePath ? `/api/submissions/${sub.id}/image` : null,
    extracted_data: (sub.extractedData as SubmissionDetail["extracted_data"]) ?? null,
    extraction_uncertain: (sub.extractionUncertain as SubmissionDetail["extraction_uncertain"]) ?? null,
    essay_text: sub.essayText ?? "",
    last_error_code: sub.lastErrorCode,
    created_at: sub.createdAt.toISOString(),
    graded_at: sub.gradedAt?.toISOString() ?? null,
    result: toSubmissionResult(sub, session),
    polished: sub.polished ? toPolishedView(sub, sub.polished) : null,
    question: sub.question ? { id: sub.question.id, name: sub.question.name } : null,
  };
}
