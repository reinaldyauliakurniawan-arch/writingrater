import { AppError, handle, ok, readJson } from "@/lib/errors";
import { requireAdmin } from "@/lib/authz";
import { getStoredApiKey } from "@/lib/settings";
import { normalizeBaseUrl, TestBody } from "@/lib/settingsInput";
import { runConnectionTest } from "@/lib/llm/connectionTest";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  await requireAdmin();
  const body = TestBody.parse(await readJson(req));
  const apiKey = body.api_key || (await getStoredApiKey());
  if (!apiKey) throw new AppError("VALIDATION_ERROR");
  const result = await runConnectionTest({
    provider: body.provider,
    model: body.model,
    apiKey,
    baseUrl: normalizeBaseUrl(body.provider, body.base_url),
  });
  return ok(result);
});
