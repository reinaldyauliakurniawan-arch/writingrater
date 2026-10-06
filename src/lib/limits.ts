import "server-only";
import type { LlmAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7, tanpa DST

/** 00:00 hari ini zona Asia/Jakarta, sebagai instant UTC. */
export function startOfJakartaDay(now = new Date()): Date {
  const local = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - JAKARTA_OFFSET_MS);
}

/** count(distinct action_id) hari ini untuk user + action. */
export async function usedToday(userId: string, action: LlmAction): Promise<number> {
  const rows = await prisma.llmCall.findMany({
    where: { userId, action, createdAt: { gte: startOfJakartaDay() } },
    distinct: ["actionId"],
    select: { actionId: true },
  });
  return rows.length;
}

export async function getUsage(userId: string) {
  const { limits } = await getSettings();
  const [grade, polish, extract] = await Promise.all([
    usedToday(userId, "grade"),
    usedToday(userId, "polish"),
    usedToday(userId, "extract"),
  ]);
  return {
    grade: { used: grade, limit: limits.grade },
    polish: { used: polish, limit: limits.polish },
    extract: { used: extract, limit: limits.extract },
  };
}

/** Dicek sebelum memanggil LLM: used >= limit -> DAILY_LIMIT_REACHED. */
export async function assertWithinLimit(userId: string, action: LlmAction) {
  const { limits } = await getSettings();
  if ((await usedToday(userId, action)) >= limits[action]) throw new AppError("DAILY_LIMIT_REACHED");
}
