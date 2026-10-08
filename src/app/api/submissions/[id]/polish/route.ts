import { AppError, handle, ok } from "@/lib/errors";
import { getOwnedSubmissionWithPolished, requireUser } from "@/lib/authz";
import { polishSubmission } from "@/lib/llm/pipeline";
import { polishTargetOf, toPolishedView } from "@/lib/serialize";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmissionWithPolished(id, user.id);
  if (polishTargetOf(sub) === null) throw new AppError("POLISH_NOT_AVAILABLE");
  // Sudah ada versi polished: kembalikan yang tersimpan tanpa memanggil LLM.
  if (sub.polished) return ok(toPolishedView(sub, sub.polished));

  await polishSubmission(sub, user.id);
  const updated = await getOwnedSubmissionWithPolished(id, user.id);
  return ok(toPolishedView(updated, updated.polished!));
});
