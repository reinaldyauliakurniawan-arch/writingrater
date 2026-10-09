import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { getOwnedSession, getOwnedSubmission, getOwnedSubmissionWithPolished, requireUser, updateOwnedSubmission } from "@/lib/authz";
import { getQuestion } from "@/lib/questions";
import { copyImage, deleteImage } from "@/lib/storage";
import { toSubmissionDetail } from "@/lib/serialize";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";

const Body = z.object({ question_id: z.string().uuid() });

/** Isi soal submission dari database soal. Task 1 langsung "confirmed" (data grafik sudah dicek). */
export const POST = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  const q = await getQuestion(body.question_id);
  if (q.taskType !== sub.taskType) throw new AppError("VALIDATION_ERROR");

  const imagePath = q.imagePath ? await copyImage(q.imagePath, user.id, sub.id) : null;
  if (sub.promptImagePath && sub.promptImagePath !== imagePath) await deleteImage(sub.promptImagePath);
  const hasData = sub.taskType === "task1_academic" && q.extractedData !== null;
  await updateOwnedSubmission(sub.id, user.id, {
    promptText: q.promptText,
    promptImagePath: imagePath,
    extractedData: hasData ? (q.extractedData as Prisma.InputJsonValue) : Prisma.DbNull,
    extractionUncertain: Prisma.DbNull,
    status: hasData ? "confirmed" : "draft",
    question: { connect: { id: q.id } },
  });
  const updated = await getOwnedSubmissionWithPolished(id, user.id);
  const session = updated.sessionId ? await getOwnedSession(updated.sessionId, user.id) : null;
  return ok(toSubmissionDetail(updated, session));
});
