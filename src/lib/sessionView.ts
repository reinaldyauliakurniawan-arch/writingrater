import "server-only";
import { getOwnedSession, getOwnedSubmissionWithPolished, listOwnedSessionSubmissions } from "@/lib/authz";
import { toSubmissionDetail } from "@/lib/serialize";
import type { SessionView } from "@/lib/types";

/** `{ session, task1, task2 }` untuk GET /api/sessions/:id dan halaman sesi. */
export async function loadSessionView(id: string, userId: string): Promise<SessionView> {
  const session = await getOwnedSession(id, userId);
  const subs = await listOwnedSessionSubmissions(id, userId);
  const detail = async (taskType: "task1_academic" | "task2") => {
    const s = subs.find((x) => x.taskType === taskType);
    return s ? toSubmissionDetail(await getOwnedSubmissionWithPolished(s.id, userId), session) : null;
  };
  return {
    session: {
      id: session.id,
      writing_band: session.writingBand,
      writing_band_raw: session.writingBandRaw,
      created_at: session.createdAt.toISOString(),
    },
    task1: await detail("task1_academic"),
    task2: await detail("task2"),
  };
}
