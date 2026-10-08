import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import SessionFlow from "@/components/SessionFlow";
import { requireUser } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { loadSessionView } from "@/lib/sessionView";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let view;
  try {
    view = await loadSessionView(id, user.id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <PageShell>
      <SessionFlow initial={view} />
    </PageShell>
  );
}
