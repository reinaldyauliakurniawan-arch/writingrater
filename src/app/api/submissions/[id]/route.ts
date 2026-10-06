import { z } from "zod";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { getOwnedSession, getOwnedSubmission, getOwnedSubmissionWithPolished, requireUser, updateOwnedSubmission } from "@/lib/authz";
import { toSubmissionDetail } from "@/lib/serialize";
import { resetExtractionIfNeeded, type IdContext } from "@/lib/routeUtils";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmissionWithPolished(id, user.id);
  const session = sub.sessionId ? await getOwnedSession(sub.sessionId, user.id) : null;
  return ok(toSubmissionDetail(sub, session));
});

const PatchBody = z.object({
  prompt_text: z.string().max(5000).optional(),
  essay_text: z.string().max(10000).optional(),
});

export const PATCH = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = PatchBody.parse(await readJson(req));
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  const promptChanged = body.prompt_text !== undefined && body.prompt_text !== sub.promptText;
  await updateOwnedSubmission(sub.id, user.id, {
      ...(body.prompt_text !== undefined ? { promptText: body.prompt_text } : {}),
      ...(body.essay_text !== undefined ? { essayText: body.essay_text } : {}),
      ...(promptChanged ? resetExtractionIfNeeded(sub) : {}),
    });
  const updated = await getOwnedSubmissionWithPolished(id, user.id);
  const session = updated.sessionId ? await getOwnedSession(updated.sessionId, user.id) : null;
  return ok(toSubmissionDetail(updated, session));
});
