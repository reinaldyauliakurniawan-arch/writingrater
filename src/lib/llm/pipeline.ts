import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, Submission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MIN_WORDS, PROMPT_VERSION } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { assertWithinLimit } from "@/lib/limits";
import { readImage } from "@/lib/storage";
import { countWords, type WordCount } from "@/lib/scoring/wordCount";
import { applyHardRules, bandsOf, lengthFlags } from "@/lib/scoring/hardRules";
import { applyCeilings } from "@/lib/scoring/ceilings";
import { polishTarget, taskBand, writingBand } from "@/lib/scoring/rounding";
import { mapCriteria, type Bands, type CriterionKey, type TaskType } from "@/lib/scoring/types";
import { callStructured, LlmError, type CallLog } from "./callStructured";
import { checkExtractedData, checkGradeOutput, ExtractedData, FactCheck, GradeOutput, PolishOutput } from "./schemas";
import { compareExtraction } from "./compareExtraction";
import { buildExtractContent, EXTRACT_SYSTEM } from "./prompts/extract";
import { buildGradeContent, buildGradeSystem } from "./prompts/grade";
import { buildFactcheckContent, FACTCHECK_SYSTEM } from "./prompts/factcheck";
import { buildPolishContent, buildPolishSystem } from "./prompts/polish";

export type StoredCriterion = { band: number; feedback: string; tip: string | null; evidence: string[] };

export type GradeResult = {
  criteria: Record<CriterionKey, StoredCriterion>;
  raw_bands: Bands;
  ceilings_applied: string[];
  language_check: "english" | "not_english" | null; // null = tidak dinilai LLM (<= 20 kata)
  fact_check: FactCheck | null;
  underlength: boolean;
  severeUnderlength: boolean;
};

export type GradeCoreResult = {
  wordCount: WordCount;
  gradeResult: GradeResult;
  bands: Bands;
  taskBand: number;
  taskBandRaw: number;
  model: string | null;
  usedLlm: boolean;
};

export type GradeInput = {
  task: TaskType;
  promptText: string;
  image: { data: Uint8Array; mimeType: string } | null;
  extractedData: ExtractedData | null;
  essayText: string;
};

/** Log context per panggilan; null = tanpa llm_calls (kalibrasi). */
export type LogContext = { userId: string; submissionId?: string; action: CallLog["action"]; actionId: string } | null;

function scoreOf(bands: Bands) {
  const t = taskBand([bands.task, bands.cc, bands.lr, bands.gra]);
  return { taskBand: t.band, taskBandRaw: t.raw };
}

/**
 * Penilaian murni (tanpa simpan): 4.1 -> 4.2 -> 6.3 -> 6.4 -> 4.2(3) -> 4.3 -> 4.4.
 * `beforeLlm` dipanggil setelah aturan keras, tepat sebelum LLM (untuk cek batas harian).
 */
export async function gradeCore(
  input: GradeInput,
  log: LogContext,
  opts: { kind?: "grade" | "rescore"; beforeLlm?: () => Promise<void>; fixture?: string } = {},
): Promise<GradeCoreResult> {
  const wordCount = countWords(input.essayText, input.promptText);
  const flags = lengthFlags(input.task, wordCount.counted);

  const pre = applyHardRules({ task: input.task, counted: wordCount.counted });
  if (pre.kind === "reject") throw new AppError(pre.code);
  if (pre.kind === "fixed") {
    const criteria = mapCriteria((k): StoredCriterion => ({ ...pre.criteria[k], evidence: [] }));
    const bands = bandsOf(criteria);
    return {
      wordCount,
      gradeResult: {
        criteria,
        raw_bands: bands,
        ceilings_applied: [],
        language_check: null,
        fact_check: null,
        ...flags,
      },
      bands,
      ...scoreOf(bands),
      model: null,
      usedLlm: false,
    };
  }

  await opts.beforeLlm?.();
  const callLog = (kind: CallLog["kind"]): CallLog | null => (log ? { ...log, kind } : null);

  let factCheck: FactCheck | null = null;
  if (input.task === "task1_academic") {
    if (!input.extractedData) throw new AppError("EXTRACTION_NOT_CONFIRMED");
    const fc = await callStructured({
      name: "factcheck",
      schema: FactCheck,
      system: FACTCHECK_SYSTEM,
      content: buildFactcheckContent({
        promptText: input.promptText,
        extractedData: input.extractedData,
        essayText: input.essayText,
      }),
      maxTokens: 2000,
      log: callLog("factcheck"),
    });
    factCheck = fc.value;
  }

  const graded = await callStructured({
    name: "grade",
    schema: GradeOutput,
    system: buildGradeSystem({ task: input.task, counted: wordCount.counted, ...flags }),
    content: buildGradeContent({ ...input, factCheck }),
    maxTokens: 4000,
    log: callLog(opts.kind ?? "grade"),
    validate: checkGradeOutput,
    fixture: opts.fixture,
  });
  const out = graded.value;

  const post = applyHardRules({ task: input.task, counted: wordCount.counted, languageCheck: out.language_check });
  let criteria: Record<CriterionKey, StoredCriterion>;
  let rawBands: Bands;
  let ceilingsApplied: string[] = [];
  if (post.kind === "fixed") {
    criteria = mapCriteria((k): StoredCriterion => ({ ...post.criteria[k], evidence: [] }));
    rawBands = bandsOf(criteria);
  } else {
    rawBands = bandsOf(out.criteria);
    const capped = applyCeilings(rawBands, out.ceilings_triggered, input.task);
    ceilingsApplied = capped.applied;
    criteria = mapCriteria((k) => ({
      band: capped.bands[k],
      feedback: out.criteria[k].feedback,
      tip: out.criteria[k].tip,
      evidence: out.criteria[k].evidence,
    }));
  }
  const bands = bandsOf(criteria);
  return {
    wordCount,
    gradeResult: {
      criteria,
      raw_bands: rawBands,
      ceilings_applied: ceilingsApplied,
      language_check: out.language_check,
      fact_check: factCheck,
      ...flags,
    },
    bands,
    ...scoreOf(bands),
    model: graded.model,
    usedLlm: true,
  };
}

export async function loadPromptImage(sub: Pick<Submission, "promptImagePath">) {
  return sub.promptImagePath ? readImage(sub.promptImagePath) : null;
}

/** Aksi `grade` lengkap untuk satu submission milik user (route POST /grade). */
export async function gradeSubmission(sub: Submission, essayText: string, userId: string) {
  const actionId = randomUUID();
  const image = await loadPromptImage(sub);
  const extractedData = sub.extractedData ? ExtractedData.parse(sub.extractedData) : null;
  const wc = countWords(essayText, sub.promptText);

  // Esai + hitung kata selalu disimpan supaya tidak hilang walau LLM gagal.
  const essayFields = {
    essayText,
    wordCountTotal: wc.total,
    wordCountExcluded: wc.excluded,
    wordCountCounted: wc.counted,
  };

  let result: GradeCoreResult;
  try {
    result = await gradeCore(
      { task: sub.taskType, promptText: sub.promptText, image, extractedData, essayText },
      { userId, submissionId: sub.id, action: "grade", actionId },
      { beforeLlm: () => assertWithinLimit(userId, "grade") },
    );
  } catch (e) {
    const code = e instanceof AppError ? e.code : "LLM_FAILED";
    await prisma.submission.update({ where: { id: sub.id, userId }, data: { ...essayFields, lastErrorCode: code } });
    if (e instanceof AppError) throw e;
    throw new LlmError(e);
  }

  const updated = await prisma.submission.update({
    where: { id: sub.id, userId },
    data: {
      ...essayFields,
      status: "graded",
      factErrors: (result.gradeResult.fact_check?.fact_errors ?? undefined) as Prisma.InputJsonValue | undefined,
      gradeResult: result.gradeResult as unknown as Prisma.InputJsonValue,
      bandTask: result.bands.task,
      bandCc: result.bands.cc,
      bandLr: result.bands.lr,
      bandGra: result.bands.gra,
      taskBandRaw: result.taskBandRaw,
      taskBand: result.taskBand,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      lastErrorCode: null,
      gradedAt: new Date(),
    },
  });

  if (updated.sessionId) await updateWritingBand(updated.sessionId, userId);
  return updated;
}

/** Skor Writing hanya kalau Task 1 dan Task 2 di sesi sudah graded (4.4). */
export async function updateWritingBand(sessionId: string, userId: string) {
  const subs = await prisma.submission.findMany({ where: { sessionId, userId, status: "graded" } });
  const t1 = subs.find((s) => s.taskType === "task1_academic");
  const t2 = subs.find((s) => s.taskType === "task2");
  if (!t1 || !t2 || t1.taskBandRaw === null || t2.taskBandRaw === null) return;
  const w = writingBand(t1.taskBandRaw, t2.taskBandRaw);
  await prisma.writingSession.updateMany({
    where: { id: sessionId, userId },
    data: { writingBandRaw: w.raw, writingBand: w.band },
  });
}

export const minWordsOf = (task: TaskType) => MIN_WORDS[task];

/** Aksi `extract` (bagian 6.2): dua panggilan paralel, bandingkan, simpan A. Status -> extracted. */
export async function extractSubmission(sub: Submission, userId: string) {
  if (!sub.promptImagePath) throw new AppError("IMAGE_REQUIRED");
  const image = await readImage(sub.promptImagePath);
  const actionId = randomUUID();
  const log = (): CallLog => ({ userId, submissionId: sub.id, action: "extract", actionId, kind: "extract" });
  const call = (fixture: string) =>
    callStructured({
      name: "extract",
      schema: ExtractedData,
      system: EXTRACT_SYSTEM,
      content: buildExtractContent({ image, promptText: sub.promptText }),
      maxTokens: 4000,
      log: log(),
      validate: checkExtractedData,
      fixture,
    });

  await assertWithinLimit(userId, "extract");
  let a: ExtractedData;
  let b: ExtractedData;
  try {
    [{ value: a }, { value: b }] = await Promise.all([call("extract"), call("extract-b")]);
  } catch (e) {
    const code = e instanceof AppError ? e.code : "LLM_FAILED";
    await prisma.submission.update({ where: { id: sub.id, userId }, data: { lastErrorCode: code } });
    if (e instanceof AppError) throw e;
    throw new LlmError(e);
  }

  const uncertain = compareExtraction(a, b);
  return prisma.submission.update({
    where: { id: sub.id, userId },
    data: {
      extractedData: a as unknown as Prisma.InputJsonValue,
      extractionUncertain: uncertain as unknown as Prisma.InputJsonValue,
      status: "extracted",
      lastErrorCode: null,
    },
  });
}

const POLISH_MAX_ATTEMPTS = 2;
const POLISH_TOLERANCE = 0.5;

/**
 * Aksi `polish` (bagian 6.5): tulis ulang -> rescore (factcheck Task 1 + grade) -> kalau meleset > 0.5
 * dari target, satu percobaan lagi. Simpan versi paling dekat ke target (seri -> versi kedua).
 * Pemanggil sudah memastikan status graded, target tersedia, dan belum ada PolishedVersion.
 */
export async function polishSubmission(sub: Submission, userId: string) {
  const target = sub.taskBand === null ? null : polishTarget(sub.taskBand);
  const previous = sub.gradeResult as unknown as GradeResult | null;
  if (target === null || !previous || !sub.essayText) throw new AppError("POLISH_NOT_AVAILABLE");

  await assertWithinLimit(userId, "polish");
  const actionId = randomUUID();
  const log = { userId, submissionId: sub.id, action: "polish" as const, actionId };
  const image = await loadPromptImage(sub);
  const extractedData = sub.extractedData ? ExtractedData.parse(sub.extractedData) : null;
  const previousGrade = mapCriteria((k) => ({
    band: previous.criteria[k].band,
    feedback: previous.criteria[k].feedback,
    tip: previous.criteria[k].tip,
  }));

  type Attempt = { text: string; rescore: GradeCoreResult };
  const attempts: Attempt[] = [];
  try {
    while (attempts.length < POLISH_MAX_ATTEMPTS) {
      const last = attempts.at(-1);
      if (last && Math.abs(last.rescore.taskBand - target) <= POLISH_TOLERANCE) break;
      const polished = await callStructured({
        name: "polish",
        schema: PolishOutput,
        system: buildPolishSystem({ task: sub.taskType, target }),
        content: buildPolishContent({
          task: sub.taskType,
          promptText: sub.promptText,
          image,
          extractedData,
          factCheck: previous.fact_check,
          essayText: sub.essayText,
          previousGrade,
          retry: last ? { previousRewrite: last.text, rescored: last.rescore.taskBand, target } : undefined,
        }),
        maxTokens: 3000,
        log: { ...log, kind: "polish" },
      });
      const text = polished.value.polished_text.trim();
      const rescore = await gradeCore(
        { task: sub.taskType, promptText: sub.promptText, image, extractedData, essayText: text },
        log,
        { kind: "rescore", fixture: "rescore" },
      );
      attempts.push({ text, rescore });
    }
  } catch (e) {
    const code = e instanceof AppError ? e.code : "LLM_FAILED";
    await prisma.submission.update({ where: { id: sub.id, userId }, data: { lastErrorCode: code } });
    if (e instanceof AppError) throw e;
    throw new LlmError(e);
  }

  // Paling dekat ke target; seri -> versi yang lebih baru.
  const best = attempts.reduce((a, b) =>
    Math.abs(b.rescore.taskBand - target) <= Math.abs(a.rescore.taskBand - target) ? b : a,
  );
  const rescoredResult = { ...best.rescore.gradeResult, word_count: best.rescore.wordCount, task_band_raw: best.rescore.taskBandRaw };
  try {
    await prisma.polishedVersion.create({
      data: {
        submissionId: sub.id,
        userId,
        targetBand: target,
        polishedText: best.text,
        rescoredResult: rescoredResult as unknown as Prisma.InputJsonValue,
        rescoredTaskBand: best.rescore.taskBand,
        attempts: attempts.length,
      },
    });
  } catch (e) {
    // Request paralel sudah menyimpan versi polished -> pakai yang tersimpan.
    if (!(typeof e === "object" && e && "code" in e && e.code === "P2002")) throw e;
  }
  await prisma.submission.update({ where: { id: sub.id, userId }, data: { lastErrorCode: null } });
}
