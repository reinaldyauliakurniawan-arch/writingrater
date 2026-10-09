"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/apiClient";
import type { QuestionView, SubmissionDetail } from "@/lib/types";
import ErrorBanner from "./ErrorBanner";

type Props = {
  detail: SubmissionDetail;
  onSaved: (question: { id: string; name: string }) => void;
};

/** Simpan soal submission ini ke database soal bersama, atau tampilkan namanya kalau sudah tersimpan. */
export default function SaveQuestion({ detail, onSaved }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.question) {
    return (
      <p className="text-sm text-muted">
        Soal ini ada di database soal: <span className="font-semibold text-ink">{detail.question.name}</span>
      </p>
    );
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Isi nama soal dulu.");
      return;
    }
    setBusy(true);
    try {
      const q = await api<QuestionView>("/api/questions", {
        method: "POST",
        json: { submission_id: detail.id, name: name.trim() },
      });
      onSaved({ id: q.id, name: q.name });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="font-semibold">Simpan soal ke database soal</p>
        <p className="text-sm text-muted">
          Pengguna lain bisa memakai soal ini tanpa perlu membaca {detail.task_type === "task1_academic" ? "grafik" : "soal"}{" "}
          ulang.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Nama soal"
          className="input min-w-0 flex-1"
          maxLength={150}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder={detail.task_type === "task1_academic" ? "mis. Cambridge 17 Test 1 Task 1" : "mis. Cambridge 17 Test 1 Task 2"}
        />
        <button type="button" className="btn-secondary" disabled={busy} onClick={save}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
      <ErrorBanner message={error} />
    </div>
  );
}
