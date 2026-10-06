import { AppError, handle, ok } from "@/lib/errors";
import { getOwnedSubmission, requireUser } from "@/lib/authz";
import { extractSubmission } from "@/lib/llm/pipeline";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.taskType !== "task1_academic") throw new AppError("WRONG_TASK_TYPE");
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  if (!sub.promptImagePath) throw new AppError("IMAGE_REQUIRED");
  if (sub.status !== "draft" && sub.status !== "extracted") throw new AppError("VALIDATION_ERROR");
  const updated = await extractSubmission(sub, user.id);
  return ok({ extracted_data: updated.extractedData, extraction_uncertain: updated.extractionUncertain });
});
