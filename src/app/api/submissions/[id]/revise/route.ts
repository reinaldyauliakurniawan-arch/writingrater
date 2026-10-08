import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError, handle, ok } from "@/lib/errors";
import { createOwnedSubmissionCopy, getOwnedSubmission, requireUser } from "@/lib/authz";
import { copyImage } from "@/lib/storage";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";

export const POST = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status !== "graded") throw new AppError("VALIDATION_ERROR");

  const newId = randomUUID();
  const imagePath = sub.promptImagePath ? await copyImage(sub.promptImagePath, user.id, newId) : null;
  const isTask1 = sub.taskType === "task1_academic";
  const created = await createOwnedSubmissionCopy(user.id, {
    id: newId,
    taskType: sub.taskType,
    sessionId: null,
    promptText: sub.promptText,
    promptImagePath: imagePath,
    extractedData: (sub.extractedData ?? undefined) as Prisma.InputJsonValue | undefined,
    essayText: sub.essayText,
    status: isTask1 && sub.extractedData ? "confirmed" : "draft",
  });
  return ok({ id: created.id }, 201);
});
