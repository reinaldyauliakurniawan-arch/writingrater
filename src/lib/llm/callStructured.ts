import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { generateObject } from "ai";
import type { z } from "zod";
import type { LlmAction, LlmKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { getModel } from "./providers";
import { isNoVisionError, providerErrorCode } from "./providerErrors";

export class LlmError extends AppError {
  constructor(public cause?: unknown) {
    super("LLM_FAILED");
    this.name = "LlmError";
  }
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mimeType: string };

export type CallLog = {
  userId: string;
  submissionId?: string;
  action: LlmAction;
  actionId: string;
  kind: LlmKind;
};

export type CallOptions<T> = {
  name: "extract" | "factcheck" | "grade" | "polish";
  schema: z.ZodType<T>;
  system: string;
  content: ContentPart[];
  maxTokens: number;
  log: CallLog | null; // null = tidak menulis llm_calls (dipakai skrip kalibrasi)
  /** Validasi tambahan; kembalikan pesan error atau null. Gagal = output invalid -> retry. */
  validate?: (value: T) => string | null;
  /** Nama fixture LLM_MOCK (default = name), mis. "extract-b" untuk panggilan ekstraksi kedua. */
  fixture?: string;
};

const RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = 50_000;
// Model reasoning (Gemini 3.x, OpenAI o-series/GPT-5) menghitung token "thinking" ke maxOutputTokens.
// Tanpa ruang tambahan jawaban JSON terpotong (finishReason "length"). Total maks 16000 supaya
// tetap di bawah batas output model lama (mis. 16384).
const REASONING_HEADROOM = 12_000;
const FIXTURE_DIR = path.join(process.cwd(), "src", "lib", "llm", "__fixtures__");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** LLM_MOCK: __fixtures__/{LLM_MOCK_SET}/{fixture}.json lalu __fixtures__/{fixture}.json. */
async function readFixture(name: string): Promise<unknown> {
  const set = process.env.LLM_MOCK_SET;
  const candidates = set ? [path.join(FIXTURE_DIR, set, `${name}.json`)] : [];
  candidates.push(path.join(FIXTURE_DIR, `${name}.json`));
  for (const file of candidates) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new Error(`fixture ${name}.json tidak ditemukan`);
}

async function writeLog(
  log: CallLog | null,
  row: { model: string; inputTokens?: number | null; outputTokens?: number | null; success: boolean; error?: string },
) {
  if (!log) return;
  await prisma.llmCall.create({
    data: {
      userId: log.userId,
      submissionId: log.submissionId ?? null,
      action: log.action,
      actionId: log.actionId,
      kind: log.kind,
      model: row.model,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      success: row.success,
      error: row.error ? row.error.slice(0, 2000) : null,
    },
  });
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
/**
 * Satu panggilan structured output (bagian 6.1): temperature 0, 1x retry, setiap percobaan di-log.
 * Kuota habis / key ditolak langsung dilempar tanpa retry.
 */
export async function callStructured<T>(opts: CallOptions<T>): Promise<{ value: T; model: string }> {
  const mock = serverEnv().llmMock;
  // Konfigurasi dicek sebelum percobaan pertama: tidak dikonfigurasi = gagal tanpa retry/log.
  const resolved = mock ? null : await getModel();
  const label = mock ? "mock:mock" : resolved!.label;

  let content = opts.content;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(RETRY_DELAY_MS);
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      let raw: unknown;
      if (mock) {
        raw = await readFixture(opts.fixture ?? opts.name);
      } else {
        const result = await generateObject({
          model: resolved!.model,
          schema: opts.schema,
          schemaName: opts.name,
          instructions: opts.system,
          messages: [
            {
              role: "user",
              content: content.map((c) =>
                c.type === "text"
                  ? { type: "text" as const, text: c.text }
                  : { type: "file" as const, data: c.image, mediaType: c.mimeType },
              ),
            },
          ],
          temperature: 0,
          maxOutputTokens: opts.maxTokens + REASONING_HEADROOM,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        raw = result.object;
        usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
      }
      const value = opts.schema.parse(raw);
      const extra = opts.validate?.(value);
      if (extra) throw new Error(`validation: ${extra}`);
      await writeLog(opts.log, { model: label, ...usage, success: true });
      return { value, model: label };
    } catch (e) {
      lastError = e;
      await writeLog(opts.log, { model: label, ...usage, success: false, error: errorText(e) });
      const code = providerErrorCode(e);
      if (code) throw new AppError(code);
      // Model teks saja: ekstraksi grafik mustahil; panggilan lain diulang tanpa gambar.
      if (isNoVisionError(e) && content.some((c) => c.type === "image")) {
        if (opts.name === "extract") throw new AppError("LLM_NO_VISION");
        content = content.filter((c) => c.type === "text");
        attempt--;
      }
    }
  }
  throw new LlmError(lastError);
}
