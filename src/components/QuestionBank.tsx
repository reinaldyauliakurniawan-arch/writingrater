"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/apiClient";
import { formatDate } from "@/lib/format";
import { emptyExtractedData, type ExtractedData } from "@/lib/llm/schemas";
import type { QuestionView } from "@/lib/types";
import ErrorBanner from "./ErrorBanner";
import ExtractionEditor from "./ExtractionEditor";

const SECTIONS = [
  ["task1_academic", "Task 1 Academic"],
  ["task2", "Task 2"],
] as const;

export default function QuestionBank({ initial }: { initial: QuestionView[] }) {
  const [questions, setQuestions] = useState(initial);
  const replace = (q: QuestionView) => setQuestions((list) => list.map((x) => (x.id === q.id ? q : x)));
  const remove = (id: string) => setQuestions((list) => list.filter((x) => x.id !== id));

  return (
    <div className="space-y-8">
      <p className="text-muted">
        Soal yang disimpan pengguna bisa dipakai siapa saja saat membuat Task baru, tanpa perlu membaca grafik ulang.
        Simpan soal dari langkah Jawaban atau Hasil. Soal hanya bisa diubah oleh pembuatnya atau admin.
      </p>
      {SECTIONS.map(([type, label]) => {
        const list = questions.filter((q) => q.task_type === type);
        return (
          <section key={type}>
            <h2 className="mb-3 text-lg font-bold">
              {label} <span className="font-normal text-muted">({list.length})</span>
            </h2>
            {list.length === 0 ? (
              <p className="text-muted">Belum ada soal.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((q) => (
                  <li key={q.id}>
                    <QuestionItem question={q} onChange={replace} onDelete={() => remove(q.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function QuestionItem(props: { question: QuestionView; onChange: (q: QuestionView) => void; onDelete: () => void }) {
  const q = props.question;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(q.name);
  const [promptText, setPromptText] = useState(q.prompt_text);
  const [data, setData] = useState<ExtractedData>(q.extracted_data ?? emptyExtractedData());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTask1 = q.task_type === "task1_academic";

  function cancel() {
    setName(q.name);
    setPromptText(q.prompt_text);
    setData(q.extracted_data ?? emptyExtractedData());
    setEditing(false);
    setError(null);
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const updated = await api<QuestionView>(`/api/questions/${q.id}`, {
        method: "PATCH",
        json: { name, prompt_text: promptText, ...(isTask1 ? { extracted_data: data } : {}) },
      });
      props.onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/questions/${q.id}`, { method: "DELETE" });
      props.onDelete();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary className="cursor-pointer">
        <span className="font-semibold">{q.name}</span>
        <span className="block text-sm text-muted">
          {q.created_by_name ? `oleh ${q.created_by_name} · ` : ""}
          {formatDate(q.created_at)}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        {editing ? (
          <>
            <div>
              <label className="label text-sm" htmlFor={`name-${q.id}`}>
                Nama soal
              </label>
              <input id={`name-${q.id}`} className="input" maxLength={150} value={name} disabled={busy}
                onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label text-sm" htmlFor={`prompt-${q.id}`}>
                Teks soal
              </label>
              <textarea id={`prompt-${q.id}`} className="input min-h-28" maxLength={5000} value={promptText} disabled={busy}
                onChange={(e) => setPromptText(e.target.value)} />
            </div>
          </>
        ) : (
          q.prompt_text && <p className="whitespace-pre-wrap">{q.prompt_text}</p>
        )}
        {q.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.image_url} alt={`Gambar soal ${q.name}`} className="max-h-80 w-full rounded-xl object-contain" />
        )}
        {isTask1 && (
          <div>
            <p className="label text-sm">Data grafik</p>
            <ExtractionEditor value={data} uncertain={null} onChange={setData} disabled={!editing || busy} />
          </div>
        )}
        <ErrorBanner message={error} />
        {q.can_edit && (
          <div className="flex flex-wrap items-center gap-3">
            {editing ? (
              <>
                <button type="button" className="btn-primary" disabled={busy} onClick={save}>
                  {busy ? "Menyimpan…" : "Simpan perubahan"}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={cancel}>
                  Batal
                </button>
              </>
            ) : confirmDelete ? (
              <>
                <span className="font-semibold">Hapus soal ini dari database?</span>
                <button type="button" className="btn-primary bg-danger hover:bg-danger" disabled={busy} onClick={del}>
                  Ya, hapus
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Batal
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setConfirmDelete(true)}>
                  Hapus
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
