import Link from "next/link";
import PageShell from "@/components/PageShell";
import { requireUser } from "@/lib/authz";
import { loadHistory } from "@/lib/historyView";
import { band1, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const TASK_LABEL = { task1_academic: "Task 1 Academic", task2: "Task 2" } as const;

export default async function HistoryPage() {
  const user = await requireUser();
  const history = await loadHistory(user.id);
  return (
    <PageShell>
      <h1 className="page-title mb-4">Riwayat</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Sesi Writing lengkap</h2>
        {history.sessions.length === 0 ? (
          <p className="text-muted">Belum ada sesi.</p>
        ) : (
          <ul className="space-y-2">
            {history.sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/sessions/${s.id}`} className="card-click flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm text-muted">{formatDate(s.created_at)}</span>
                    <span className="font-semibold">Sesi Writing lengkap</span>
                  </span>
                  <span className="shrink-0 font-bold text-primary-dark">
                    {s.writing_band !== null ? band1(s.writing_band) : "Belum selesai"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Submission</h2>
        {history.submissions.length === 0 ? (
          <p className="text-muted">Belum ada submission.</p>
        ) : (
          <ul className="space-y-2">
            {history.submissions.map((s) => (
              <li key={s.id}>
                <Link href={`/submissions/${s.id}`} className="card-click flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm text-muted">{formatDate(s.created_at)}</span>
                    <span className="font-semibold">
                      {TASK_LABEL[s.task_type]}
                      {s.session_id && <span className="font-normal text-muted"> · bagian dari sesi</span>}
                    </span>
                    {s.prompt_preview && <span className="block truncate text-sm text-muted">{s.prompt_preview}</span>}
                  </span>
                  <span className="shrink-0 font-bold text-primary-dark">
                    {s.status === "graded" && s.task_band !== null ? band1(s.task_band) : "Belum selesai"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
