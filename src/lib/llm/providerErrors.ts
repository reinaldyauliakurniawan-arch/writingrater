import { APICallError } from "ai";

// Pola teks error dari Anthropic, OpenAI, Google, dan provider OpenAI-compatible (DeepSeek, OpenRouter, dll.).
const QUOTA_PATTERN =
  /quota|rate.?limit|resource.?exhausted|credit balance|insufficient.?(balance|funds|credits?)|billing/i;
const KEY_PATTERN = /api.?key.*(invalid|not valid|incorrect)|invalid.*api.?key|authentication|unauthori[sz]ed/i;

const NO_VISION_PATTERN =
  /multimodal|image.{0,40}(not supported|unsupported|not enabled)|(does not|doesn't|not) support.{0,20}image|vision.{0,20}(not supported|unsupported)|image_url/i;

/** Model tidak bisa menerima gambar (mis. model teks saja di vLLM/OpenAI-compatible). */
export function isNoVisionError(e: unknown): boolean {
  const text = APICallError.isInstance(e) ? `${e.message} ${e.responseBody ?? ""}` : e instanceof Error ? e.message : "";
  return NO_VISION_PATTERN.test(text);
}

/** Error provider yang tidak akan sembuh dengan retry: kuota/limit habis atau API key ditolak. */
export function providerErrorCode(e: unknown): "LLM_QUOTA_EXCEEDED" | "LLM_KEY_INVALID" | null {
  if (!APICallError.isInstance(e)) return null;
  const text = `${e.message} ${e.responseBody ?? ""}`;
  if (e.statusCode === 429 || e.statusCode === 402 || QUOTA_PATTERN.test(text)) return "LLM_QUOTA_EXCEEDED";
  if (e.statusCode === 401 || e.statusCode === 403 || KEY_PATTERN.test(text)) return "LLM_KEY_INVALID";
  return null;
}
