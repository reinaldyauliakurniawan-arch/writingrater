import { AppError, handle, ok, readJson } from "@/lib/errors";
import { requireAdmin } from "@/lib/authz";
import { getPublicSettings, getSettings, getStoredApiKey, saveSettings } from "@/lib/settings";
import { normalizeBaseUrl, PutBody } from "@/lib/settingsInput";
import { runConnectionTest } from "@/lib/llm/connectionTest";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = handle(async () => {
  await requireAdmin();
  return ok(await getPublicSettings());
});

export const PUT = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const body = PutBody.parse(await readJson(req));
  const row = (await getSettings()).row;
  const baseUrl = normalizeBaseUrl(body.provider, body.base_url);
  const newKey = body.api_key || null;

  // Tes wajib hanya kalau LLM aktif berubah: key baru, atau key tersimpan dengan provider/model/base_url baru.
  const llmFieldsChanged =
    !row || row.provider !== body.provider || row.model !== body.model || (row.baseUrl ?? null) !== baseUrl;
  const needsTest = newKey !== null || (!!row?.apiKeyEncrypted && llmFieldsChanged);

  let testOk: boolean | null = null;
  if (needsTest) {
    const apiKey = newKey ?? (await getStoredApiKey());
    if (!apiKey) throw new AppError("SETTINGS_TEST_FAILED", "API key belum diisi");
    // Server selalu menjalankan ulang tes; hasil tes di browser tidak dipercaya.
    const test = await runConnectionTest({ provider: body.provider, model: body.model, apiKey, baseUrl });
    if (!test.ok) throw new AppError("SETTINGS_TEST_FAILED", test.error ?? "tidak diketahui");
    testOk = true;
  }

  await saveSettings(
    {
      provider: body.provider,
      model: body.model,
      baseUrl,
      apiKey: newKey,
      testOk,
    },
    admin.email,
  );
  return ok(await getPublicSettings());
});
