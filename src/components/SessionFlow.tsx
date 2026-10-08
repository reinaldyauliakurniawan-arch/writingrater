"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/apiClient";
import { band1 } from "@/lib/format";
import type { SessionView, SubmissionDetail } from "@/lib/types";
import ErrorBanner from "./ErrorBanner";
import TaskFlow from "./TaskFlow";

type Step = "task1" | "task2" | "summary";

function defaultStep(v: SessionView): Step {
  if (v.task1?.status === "graded" && v.task2?.status === "graded") return "summary";
  if (v.task2) return "task2";
  return "task1";
}

export default function SessionFlow({ initial }: { initial: SessionView }) {
  const [view, setView] = useState(initial);
  const [step, setStep] = useState<Step>(defaultStep(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = view.session.id;

  const reload = useCallback(async () => {
    const v = await api<SessionView>(`/api/sessions/${sessionId}`);
    setView(v);
    return v;
  }, [sessionId]);

  const createTask = useCallback(
    async (taskType: "task1_academic" | "task2") => {
      setBusy(true);
      setError(null);
      try {
        await api(`/api/submissions`, { method: "POST", json: { task_type: taskType, session_id: sessionId } });
      } catch (e) {
        // Slot sudah terisi (mis. dibuka di dua tab) -> cukup muat ulang.
        if (!(e instanceof ApiClientError && e.code === "SESSION_SLOT_TAKEN")) setError(errorMessage(e));
      }
      try {
        await reload();
        setStep(taskType === "task1_academic" ? "task1" : "task2");
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [sessionId, reload],
  );

  const onTask1Change = useCallback((d: SubmissionDetail) => setView((v) => ({ ...v, task1: d })), []);
  const onTask2Change = useCallback(
    (d: SubmissionDetail) => {
      setView((v) => ({ ...v, task2: d }));
      if (d.status === "graded") void reload().then(() => setStep("summary"));
    },
    [reload],
  );

  const bothGraded = view.task1?.status === "graded" && view.task2?.status === "graded";
  const steps: { key: Step; label: string; enabled: boolean }[] = [
    { key: "task1", label: "Task 1", enabled: !!view.task1 },
    { key: "task2", label: "Task 2", enabled: !!view.task2 },
    { key: "summary", label: "Ringkasan", enabled: bothGraded },
  ];

  return (
    <div className="space-y-5">
      <nav aria-label="Langkah sesi" className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">→</span>}
            <button
              type="button"
              disabled={!s.enabled}
              onClick={() => setStep(s.key)}
              className={`rounded-full px-3 py-1 font-semibold shadow-sm transition duration-150 ${
                step === s.key
                  ? "bg-primary text-white"
                  : s.enabled
                    ? "bg-primary-soft text-primary-dark hover:bg-white"
                    : "bg-white text-muted"
              }`}
            >
              {s.label}
            </button>
          </span>
        ))}
      </nav>

      <ErrorBanner message={error} />

      {step === "task1" && view.task1 && (
        <TaskFlow
          key={view.task1.id}
          initial={view.task1}
          onChange={onTask1Change}
          afterResult={
            <div className="pt-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => (view.task2 ? setStep("task2") : createTask("task2"))}
              >
                Lanjut ke Task 2
              </button>
            </div>
          }
        />
      )}
      {step === "task1" && !view.task1 && (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => createTask("task1_academic")}>
          Mulai Task 1
        </button>
      )}

      {step === "task2" && view.task2 && (
        <TaskFlow
          key={view.task2.id}
          initial={view.task2}
          onChange={onTask2Change}
          afterResult={
            bothGraded ? (
              <div className="pt-2">
                <button type="button" className="btn-primary" onClick={() => setStep("summary")}>
                  Lihat ringkasan
                </button>
              </div>
            ) : null
          }
        />
      )}

      {step === "summary" && bothGraded && <Summary view={view} />}
    </div>
  );
}

function Summary({ view }: { view: SessionView }) {
  const t1 = view.task1!.result!;
  const t2 = view.task2!.result!;
  const { writing_band, writing_band_raw } = view.session;
  return (
    <div className="card space-y-3">
      <h1 className="page-title">Ringkasan</h1>
      <p>Task 1: {band1(t1.task_band)}</p>
      <p>Task 2: {band1(t2.task_band)}</p>
      {writing_band !== null && writing_band_raw !== null ? (
        <>
          <p className="text-[32px] font-bold">
            Skor Writing: <span className="rounded-lg bg-accent px-2 text-ink shadow-sm">{band1(writing_band)}</span>
          </p>
          <p className="text-sm text-muted">
            (Task 1 + 2 × Task 2) / 3 = {writing_band_raw.toFixed(2)} → dibulatkan ke {band1(writing_band)}
          </p>
        </>
      ) : (
        <p className="text-muted">Skor Writing sedang dihitung…</p>
      )}
      <div className="flex flex-wrap gap-3 pt-2 text-sm font-semibold">
        <Link href={`/submissions/${view.task1!.id}`} className="text-primary-dark hover:underline">
          Lihat hasil Task 1
        </Link>
        <Link href={`/submissions/${view.task2!.id}`} className="text-primary-dark hover:underline">
          Lihat hasil Task 2
        </Link>
      </div>
      <p className="text-sm text-muted">Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS.</p>
    </div>
  );
}
