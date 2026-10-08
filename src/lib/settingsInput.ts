import "server-only";
import { z } from "zod";
import { isValidBaseUrl, PROVIDERS, requiresBaseUrl } from "@/lib/llm/providers";

const Llm = {
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(200),
  base_url: z.string().trim().max(500).nullish(),
  api_key: z.string().trim().max(500).nullish(),
};

function checkBaseUrl(v: { provider: string; base_url?: string | null }, ctx: z.RefinementCtx) {
  if (requiresBaseUrl(v.provider)) {
    if (!v.base_url || !isValidBaseUrl(v.base_url)) {
      ctx.addIssue({ code: "custom", path: ["base_url"], message: "base_url wajib dan harus https://" });
    }
  }
}

export const TestBody = z.object(Llm).superRefine(checkBaseUrl);

export const PutBody = TestBody;

/** base_url hanya disimpan untuk provider yang membutuhkannya. */
export const normalizeBaseUrl = (provider: string, baseUrl?: string | null) =>
  requiresBaseUrl(provider) ? baseUrl || null : null;
