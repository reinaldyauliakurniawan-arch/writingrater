import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { generateObject } from "ai";
import { buildModel, type ModelSettings } from "./providers";
import { ConnectionTestOutput } from "./schemas";
import { isNoVisionError } from "./providerErrors";

const EXPECTED = [42, 17];
const IMAGE = path.join(process.cwd(), "src", "lib", "llm", "__fixtures__", "connection-test.png");

export type ConnectionTestResult = { ok: boolean; latency_ms: number; error?: string };

/** Hapus API key dari pesan error provider sebelum dikirim ke browser. */
function scrub(message: string, apiKey: string) {
  let m = message;
  if (apiKey) m = m.split(apiKey).join("••••");
  return m.slice(0, 500);
}

/**
 * Tes koneksi (bagian 6.6): satu generateObject dengan gambar bar chart berisi dua angka.
 * Selalu memanggil API asli (juga saat LLM_MOCK) karena tujuannya menguji provider. Tidak menulis llm_calls.
 */
export async function runConnectionTest(s: ModelSettings): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const image = new Uint8Array(await fs.readFile(IMAGE));
    const { object } = await generateObject({
      model: buildModel(s),
      schema: ConnectionTestOutput,
      schemaName: "connection_test",
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: image, mediaType: "image/png" },
            { type: "text", text: "Return the two numbers shown in the chart." },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 200,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(50_000),
    });
    const latency_ms = Date.now() - started;
    const parsed = ConnectionTestOutput.parse(object);
    const ok = EXPECTED.every((n) => parsed.numbers.includes(n));
    return ok
      ? { ok, latency_ms }
      : { ok, latency_ms, error: `Model tidak membaca angka dengan benar (mendapat: ${parsed.numbers.join(", ") || "-"})` };
  } catch (e) {
    // Model teks saja: tetap boleh disimpan, cukup tes tanpa gambar.
    if (isNoVisionError(e)) return runTextOnlyTest(s, started);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latency_ms: Date.now() - started, error: scrub(msg, s.apiKey) };
  }
}

async function runTextOnlyTest(s: ModelSettings, started: number): Promise<ConnectionTestResult> {
  try {
    const { object } = await generateObject({
      model: buildModel(s),
      schema: ConnectionTestOutput,
      schemaName: "connection_test",
      prompt: "A chart shows two bars labelled 42 and 17. Return those two numbers.",
      temperature: 0,
      maxOutputTokens: 200,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(50_000),
    });
    const latency_ms = Date.now() - started;
    const parsed = ConnectionTestOutput.parse(object);
    const ok = EXPECTED.every((n) => parsed.numbers.includes(n));
    return ok
      ? { ok, latency_ms }
      : { ok, latency_ms, error: `Model tidak mengembalikan angka yang benar (mendapat: ${parsed.numbers.join(", ") || "-"})` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latency_ms: Date.now() - started, error: scrub(msg, s.apiKey) };
  }
}
