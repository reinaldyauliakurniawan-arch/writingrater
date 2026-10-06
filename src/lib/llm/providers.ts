import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getSettings } from "@/lib/settings";
import { AppError } from "@/lib/errors";

// Satu-satunya file yang tahu nama provider dan contoh model (bagian 6.6).
export const PROVIDERS = ["anthropic", "openai", "google", "openai_compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_OPTIONS: { value: Provider; label: string; modelPlaceholder: string }[] = [
  { value: "anthropic", label: "Anthropic", modelPlaceholder: "claude-sonnet-5-5" },
  { value: "openai", label: "OpenAI", modelPlaceholder: "gpt-5.1" },
  { value: "google", label: "Google Gemini", modelPlaceholder: "gemini-3-pro" },
  { value: "openai_compatible", label: "Kompatibel OpenAI / custom", modelPlaceholder: "nama-model" },
];

export type ModelSettings = { provider: Provider; model: string; apiKey: string; baseUrl?: string | null };

export function buildModel(s: ModelSettings) {
  switch (s.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: s.apiKey })(s.model);
    case "openai":
      return createOpenAI({ apiKey: s.apiKey })(s.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: s.apiKey })(s.model);
    case "openai_compatible":
      return createOpenAICompatible({ name: "custom", apiKey: s.apiKey, baseURL: s.baseUrl! })(s.model);
  }
}

export const requiresBaseUrl = (p: string) => p === "openai_compatible";

export const modelLabel = (s: { provider: string; model: string }) => `${s.provider}:${s.model}`;

/** app_settings (decrypt key) -> env fallback -> LLM_NOT_CONFIGURED */
export async function getModel() {
  const { llm } = await getSettings();
  if (!llm) throw new AppError("LLM_NOT_CONFIGURED");
  return { model: buildModel(llm), label: modelLabel(llm) };
}

/** base_url openai_compatible: https://, atau http://localhost / http://127.0.0.1 saat development. */
export function isValidBaseUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return (
    process.env.NODE_ENV !== "production" &&
    u.protocol === "http:" &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  );
}
