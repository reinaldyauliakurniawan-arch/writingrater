import { APICallError } from "ai";

// Pola teks error dari Anthropic, OpenAI, Google, dan provider OpenAI-compatible (DeepSeek, OpenRouter, dll.).
const QUOTA_PATTERN =
  /quota|rate.?limit|resource.?exhausted|credit balance|insufficient.?(balance|funds|credits?)|billing/i;
const KEY_PATTERN = /api.?key.*(invalid|not valid|incorrect)|invalid.*api.?key|authentication|unauthori[sz]ed/i;

/** Error provider yang tidak akan sembuh dengan retry: kuota/limit habis atau API key ditolak. */
export function providerErrorCode(e: unknown): "LLM_QUOTA_EXCEEDED" | "LLM_KEY_INVALID" | null {
  if (!APICallError.isInstance(e)) return null;
  const text = `${e.message} ${e.responseBody ?? ""}`;
  if (e.statusCode === 429 || e.statusCode === 402 || QUOTA_PATTERN.test(text)) return "LLM_QUOTA_EXCEEDED";
  if (e.statusCode === 401 || e.statusCode === 403 || KEY_PATTERN.test(text)) return "LLM_KEY_INVALID";
  return null;
}
