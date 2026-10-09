import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { getOwnedSubmission, requireUser, updateOwnedSubmission } from "@/lib/authz";
import { getQuestion, listQuestions, rethrowNameTaken, toQuestionView } from "@/lib/questions";
import { copyImageToQuestion, deleteImage } from "@/lib/storage";

export const runtime = "nodejs";

const TaskType = z.enum(["task1_academic", "task2"]);

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const taskType = new URL(req.url).searchParams.get("task_type");
  return ok(await listQuestions(user, taskType ? TaskType.parse(taskType) : undefined));
});

const Body = z.object({ submission_id: z.string().uuid(), name: z.string().trim().min(1).max(150) });

/** Simpan soal dari submission milik user ke database soal bersama. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  const sub = await getOwnedSubmission(body.submission_id, user.id);
  const isTask1 = sub.taskType === "task1_academic";
  if (isTask1 && (!sub.extractedData || (sub.status !== "confirmed" && sub.status !== "graded"))) {
    throw new AppError("QUESTION_NOT_READY");
  }
  if (!sub.promptText.trim() && !sub.promptImagePath) throw new AppError("PROMPT_REQUIRED");

  const id = randomUUID();
  const imagePath = sub.promptImagePath ? await copyImageToQuestion(sub.promptImagePath, id) : null;
  try {
    await prisma.question.create({
      data: {
        id,
        taskType: sub.taskType,
        name: body.name,
        promptText: sub.promptText,
        imagePath,
        extractedData: isTask1 ? (sub.extractedData as Prisma.InputJsonValue) : undefined,
        createdById: user.id,
      },
    });
  } catch (e) {
    if (imagePath) await deleteImage(imagePath);
    rethrowNameTaken(e);
  }
  await updateOwnedSubmission(sub.id, user.id, { question: { connect: { id } } });
  return ok(toQuestionView(await getQuestion(id), user), 201);
});
