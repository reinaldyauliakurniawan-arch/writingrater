import "server-only";
import type { AppSetting, Provider } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { PROVIDERS, requiresBaseUrl } from "@/lib/llm/providers";

export type LlmConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string | null;
};

export type ResolvedSettings = {
  llm: LlmConfig | null; // null = LLM_NOT_CONFIGURED
  source: "database" | "env" | "none";
  row: AppSetting | null;
};

const CACHE_MS = 30_000;
let cache: { at: number; value: ResolvedSettings } | null = null;

function envLlm(): LlmConfig | null {
  const e = serverEnv();
  const provider = e.llmProvider as Provider;
  if (!(PROVIDERS as readonly string[]).includes(provider) || !e.llmModel || !e.llmApiKey) return null;
  if (requiresBaseUrl(provider) && !e.llmBaseUrl) return null;
  return { provider, model: e.llmModel, apiKey: e.llmApiKey, baseUrl: e.llmBaseUrl || null };
}

async function load(): Promise<ResolvedSettings> {
  const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (row?.apiKeyEncrypted) {
    return {
      llm: {
        provider: row.provider,
        model: row.model,
        apiKey: decryptSecret(row.apiKeyEncrypted),
        baseUrl: row.baseUrl,
      },
      source: "database",
      row,
    };
  }
  const env = envLlm();
  return { llm: env, source: env ? "env" : "none", row };
}

/** Pengaturan aktif: app_settings (key terisi) -> env fallback -> llm null. Cache 30 detik. */
export async function getSettings(): Promise<ResolvedSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await load();
  cache = { at: Date.now(), value };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}

/** Bentuk respons GET /api/settings. Tidak pernah berisi API key. */
export async function getPublicSettings() {
  const s = await getSettings();
  const row = s.row;
  const active = s.source === "database" ? row : null;
  return {
    provider: active?.provider ?? s.llm?.provider ?? row?.provider ?? null,
    model: active?.model ?? s.llm?.model ?? row?.model ?? null,
    base_url: active?.baseUrl ?? s.llm?.baseUrl ?? row?.baseUrl ?? null,
    api_key_last4: row?.apiKeyLast4 ?? null,
    has_api_key: !!row?.apiKeyEncrypted,
    last_test_ok: row?.lastTestOk ?? null,
    last_test_at: row?.lastTestAt?.toISOString() ?? null,
    updated_at: row?.updatedAt.toISOString() ?? null,
    updated_by: row?.updatedBy ?? null,
    source: s.source,
  };
}

/** API key tersimpan (didekripsi), untuk tes koneksi dengan key lama. Hanya server. */
export async function getStoredApiKey(): Promise<string | null> {
  const row = (await getSettings()).row;
  return row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null;
}

export async function saveSettings(
  input: {
    provider: Provider;
    model: string;
    baseUrl: string | null;
    apiKey: string | null; // null = pertahankan key lama
    testOk: boolean | null; // null = tidak ada tes baru
  },
  adminEmail: string,
) {
  const keyFields = input.apiKey
    ? { apiKeyEncrypted: encryptSecret(input.apiKey), apiKeyLast4: input.apiKey.slice(-4) }
    : {};
  const testFields = input.testOk === null ? {} : { lastTestOk: input.testOk, lastTestAt: new Date() };
  const data = {
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    updatedBy: adminEmail,
    ...keyFields,
    ...testFields,
  };
  await prisma.appSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  clearSettingsCache();
}
