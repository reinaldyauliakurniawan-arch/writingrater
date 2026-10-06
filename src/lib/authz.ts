import type { Prisma, TaskType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isAdminEmail } from "@/lib/env";

export type CurrentUser = { id: string; email: string; name: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name ?? "" };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) throw new AppError("FORBIDDEN");
  return user;
}

export async function getOwnedSubmission(id: string, userId: string) {
  const s = await prisma.submission.findFirst({ where: { id, userId } });
  if (!s) throw new AppError("NOT_FOUND");
  return s;
}

export async function getOwnedSubmissionWithPolished(id: string, userId: string) {
  const s = await prisma.submission.findFirst({ where: { id, userId }, include: { polished: true } });
  if (!s) throw new AppError("NOT_FOUND");
  return s;
}

export async function getOwnedSession(id: string, userId: string) {
  const s = await prisma.writingSession.findFirst({ where: { id, userId } });
  if (!s) throw new AppError("NOT_FOUND");
  return s;
}

export async function listOwnedSessionSubmissions(sessionId: string, userId: string) {
  return prisma.submission.findMany({ where: { sessionId, userId } });
}

export async function sessionSlotTaken(sessionId: string, userId: string, taskType: TaskType) {
  const s = await prisma.submission.findFirst({ where: { sessionId, userId, taskType }, select: { id: true } });
  return s !== null;
}

export async function createOwnedSubmission(userId: string, taskType: TaskType, sessionId: string | null) {
  return prisma.submission.create({ data: { userId, taskType, sessionId, promptText: "" } });
}

/** Update hanya kalau submission milik user (where id + userId). */
export async function updateOwnedSubmission(id: string, userId: string, data: Prisma.SubmissionUpdateInput) {
  return prisma.submission.update({ where: { id, userId }, data });
}
