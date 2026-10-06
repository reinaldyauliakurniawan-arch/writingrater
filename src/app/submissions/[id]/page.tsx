import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import TaskFlow from "@/components/TaskFlow";
import { getOwnedSession, getOwnedSubmissionWithPolished, requireUser } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { toSubmissionDetail } from "@/lib/serialize";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let detail;
  try {
    const sub = await getOwnedSubmissionWithPolished(id, user.id);
    const session = sub.sessionId ? await getOwnedSession(sub.sessionId, user.id) : null;
    detail = toSubmissionDetail(sub, session);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <PageShell>
      <TaskFlow initial={detail} />
    </PageShell>
  );
}
