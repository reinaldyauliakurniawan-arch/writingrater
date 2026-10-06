import { z } from "zod";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { getOwnedSession, getOwnedSubmission, requireUser } from "@/lib/authz";
import { gradeSubmission } from "@/lib/llm/pipeline";
import { toSubmissionResult } from "@/lib/serialize";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ essay_text: z.string().max(10000) });

export const POST = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  if (sub.taskType === "task1_academic" && sub.status !== "confirmed") throw new AppError("EXTRACTION_NOT_CONFIRMED");
  if (sub.taskType === "task2" && sub.status !== "draft") throw new AppError("VALIDATION_ERROR");
  if (!sub.promptText.trim() && !sub.promptImagePath) throw new AppError("PROMPT_REQUIRED");

  const graded = await gradeSubmission(sub, body.essay_text, user.id);
  const session = graded.sessionId ? await getOwnedSession(graded.sessionId, user.id) : null;
  return ok(toSubmissionResult(graded, session));
});
