import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { getEditableQuestion, getQuestion, rethrowNameTaken, toQuestionView } from "@/lib/questions";
import { checkExtractedData, ExtractedData } from "@/lib/llm/schemas";
import { deleteImage } from "@/lib/storage";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return ok(toQuestionView(await getQuestion(id), user));
});

const PatchBody = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  prompt_text: z.string().max(5000).optional(),
  extracted_data: ExtractedData.optional(),
});

/** Ubah soal (pembuat atau admin). Submission yang sudah memakai soal ini tidak ikut berubah. */
export const PATCH = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = PatchBody.parse(await readJson(req));
  const q = await getEditableQuestion(id, user);
  if (body.extracted_data) {
    if (q.taskType !== "task1_academic") throw new AppError("WRONG_TASK_TYPE");
    if (checkExtractedData(body.extracted_data)) throw new AppError("VALIDATION_ERROR");
  }
  try {
    await prisma.question.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.prompt_text !== undefined ? { promptText: body.prompt_text } : {}),
        ...(body.extracted_data ? { extractedData: body.extracted_data as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (e) {
    rethrowNameTaken(e);
  }
  return ok(toQuestionView(await getQuestion(id), user));
});

export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const q = await getEditableQuestion(id, user);
  await prisma.question.delete({ where: { id } });
  if (q.imagePath) await deleteImage(q.imagePath);
  return ok({});
});
