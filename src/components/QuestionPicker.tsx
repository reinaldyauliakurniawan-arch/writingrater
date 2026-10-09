"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/apiClient";
import type { QuestionView, SubmissionDetail, TaskTypeValue } from "@/lib/types";
import ErrorBanner from "./ErrorBanner";

type Props = {
  submissionId: string;
  taskType: TaskTypeValue;
  disabled?: boolean;
  onUsed: (detail: SubmissionDetail) => void;
};

/** Pilih soal dari database soal bersama; Task 1 langsung lompat ke langkah jawaban. */
export default function QuestionPicker({ submissionId, taskType, disabled, onUsed }: Props) {
  const [questions, setQuestions] = useState<QuestionView[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<QuestionView[]>(`/api/questions?task_type=${taskType}`)
      .then(setQuestions)
      .catch(() => setQuestions([]));
  }, [taskType]);

  async function use() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      onUsed(
        await api<SubmissionDetail>(`/api/submissions/${submissionId}/use-question`, {
          method: "POST",
          json: { question_id: selected },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (questions === null) return null;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">Pilih dari database soal</p>
        <Link href="/questions" className="text-sm font-semibold text-primary-dark hover:underline">
          Lihat database soal
        </Link>
      </div>
      {questions.length === 0 ? (
        <p className="text-sm text-muted">
          Belum ada soal {taskType === "task1_academic" ? "Task 1" : "Task 2"} di database. Masukkan soal baru di bawah,
          lalu simpan ke database setelah selesai.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Soal dari database"
            className="input min-w-0 flex-1"
            value={selected}
            disabled={disabled || busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— Pilih soal —</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" disabled={!selected || disabled || busy} onClick={use}>
            {busy ? "Memuat…" : "Pakai soal ini"}
          </button>
        </div>
      )}
      <ErrorBanner message={error} />
      <p className="text-sm text-muted">Atau masukkan soal baru:</p>
    </div>
  );
}
