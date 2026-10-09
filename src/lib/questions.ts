import "server-only";
import type { Question } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isAdminEmail } from "@/lib/env";
import type { CurrentUser } from "@/lib/authz";
import type { QuestionView } from "@/lib/types";

type QuestionWithCreator = Question & { createdBy: { name: string } | null };

export const canEditQuestion = (q: Pick<Question, "createdById">, user: CurrentUser) =>
  isAdminEmail(user.email) || q.createdById === user.id;

export function toQuestionView(q: QuestionWithCreator, user: CurrentUser): QuestionView {
  return {
    id: q.id,
    task_type: q.taskType,
    name: q.name,
    prompt_text: q.promptText,
    image_url: q.imagePath ? `/api/questions/${q.id}/image` : null,
    extracted_data: (q.extractedData as QuestionView["extracted_data"]) ?? null,
    created_by_name: q.createdBy?.name ?? null,
    created_at: q.createdAt.toISOString(),
    can_edit: canEditQuestion(q, user),
  };
}

/** Database soal dipakai bersama: semua pengguna yang login boleh membaca. */
export async function getQuestion(id: string) {
  const q = await prisma.question.findUnique({ where: { id }, include: { createdBy: { select: { name: true } } } });
  if (!q) throw new AppError("NOT_FOUND");
  return q;
}

export async function getEditableQuestion(id: string, user: CurrentUser) {
  const q = await getQuestion(id);
  if (!canEditQuestion(q, user)) throw new AppError("QUESTION_FORBIDDEN");
  return q;
}

export async function listQuestions(user: CurrentUser, taskType?: Question["taskType"]) {
  const list = await prisma.question.findMany({
    where: taskType ? { taskType } : {},
    orderBy: { name: "asc" },
    include: { createdBy: { select: { name: true } } },
  });
  return list.map((q) => toQuestionView(q, user));
}

/** Prisma P2002 pada (taskType, name) -> nama sudah dipakai. */
export function rethrowNameTaken(e: unknown): never {
  if (typeof e === "object" && e && "code" in e && e.code === "P2002") throw new AppError("QUESTION_NAME_TAKEN");
  throw e;
}
