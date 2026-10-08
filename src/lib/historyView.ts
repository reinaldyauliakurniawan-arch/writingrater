import "server-only";
import { listOwnedSessions, listOwnedSubmissions } from "@/lib/authz";
import type { HistoryView } from "@/lib/types";

export async function loadHistory(userId: string): Promise<HistoryView> {
  const [subs, sessions] = await Promise.all([listOwnedSubmissions(userId), listOwnedSessions(userId)]);
  return {
    submissions: subs.map((s) => ({
      id: s.id,
      task_type: s.taskType,
      status: s.status,
      task_band: s.taskBand,
      session_id: s.sessionId,
      prompt_preview: s.promptText.slice(0, 120),
      created_at: s.createdAt.toISOString(),
    })),
    sessions: sessions.map((s) => ({ id: s.id, writing_band: s.writingBand, created_at: s.createdAt.toISOString() })),
  };
}
