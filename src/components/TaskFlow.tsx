"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/apiClient";
import { countWords } from "@/lib/scoring/wordCount";
import { MIN_WORDS } from "@/lib/config";
import { band1 } from "@/lib/format";
import type { PolishedView, SubmissionDetail, SubmissionResult } from "@/lib/types";
import ErrorBanner from "./ErrorBanner";
import ImageInput from "./ImageInput";
import ResultView from "./ResultView";
import PolishedPanel from "./PolishedPanel";
import ExtractionEditor from "./ExtractionEditor";
import type { ExtractedData } from "@/lib/llm/schemas";

type Props = {
  initial: SubmissionDetail;
  /** Dipanggil setelah submission berubah (mis. halaman sesi memperbarui stepper). */
  onChange?: (detail: SubmissionDetail) => void;
  /** Konten tambahan di bawah hasil (mis. tombol "Lanjut ke Task 2" di sesi). */
  afterResult?: React.ReactNode;
};

const TASK_TITLES = { task1_academic: "Task 1 Academic", task2: "Task 2" } as const;
const AUTOSAVE_MS = 2000;

export default function TaskFlow({ initial, onChange, afterResult }: Props) {
  const router = useRouter();
  const [detail, setDetailState] = useState(initial);
  const [promptText, setPromptText] = useState(initial.prompt_text);
  const [essay, setEssay] = useState(initial.essay_text);
  const [task2Answering, setTask2Answering] = useState(initial.essay_text.trim() !== "");
  const [busy, setBusy] = useState<null | "save" | "grade" | "extract" | "confirm" | "revise" | "polish">(null);
  const [showPolished, setShowPolished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDetail = useCallback(
    (d: SubmissionDetail) => {
      setDetailState(d);
      onChange?.(d);
    },
    [onChange],
  );

  const isTask1 = detail.task_type === "task1_academic";
  const step: "prompt" | "confirm" | "answer" | "result" =
    detail.status === "graded"
      ? "result"
      : isTask1
        ? detail.status === "draft"
          ? "prompt"
          : detail.status === "extracted"
            ? "confirm"
            : "answer"
        : task2Answering
          ? "answer"
          : "prompt";

  async function savePrompt() {
    return api<SubmissionDetail>(`/api/submissions/${detail.id}`, { method: "PATCH", json: { prompt_text: promptText } });
  }

  async function onTask2Next() {
    setError(null);
    if (!promptText.trim() && !detail.prompt_image_url) {
      setError("Isi soal dulu (teks atau gambar).");
      return;
    }
    setBusy("save");
    try {
      setDetail(await savePrompt());
      setTask2Answering(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function reload() {
    setDetail(await api<SubmissionDetail>(`/api/submissions/${detail.id}`));
  }

  async function onExtract() {
    setError(null);
    if (!detail.prompt_image_url) {
      setError("Task 1 wajib menyertakan gambar soal.");
      return;
    }
    setBusy("extract");
    try {
      if (promptText !== detail.prompt_text) await savePrompt();
      await api(`/api/submissions/${detail.id}/extract`, { method: "POST", json: {} });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
      await reload().catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function onConfirm(data: ExtractedData) {
    setError(null);
    setBusy("confirm");
    try {
      await api(`/api/submissions/${detail.id}/extracted-data`, { method: "PUT", json: { extracted_data: data } });
      setDetail({ ...detail, extracted_data: data, status: "confirmed" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRevise() {
    setError(null);
    setBusy("revise");
    try {
      const { id } = await api<{ id: string }>(`/api/submissions/${detail.id}/revise`, { method: "POST", json: {} });
      router.push(`/submissions/${id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function onPolish() {
    setError(null);
    if (detail.polished) {
      setShowPolished(true);
      return;
    }
    setBusy("polish");
    try {
      const polished = await api<PolishedView>(`/api/submissions/${detail.id}/polish`, { method: "POST", json: {} });
      setDetail({ ...detail, polished });
      setShowPolished(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onGrade() {
    setError(null);
    setBusy("grade");
    try {
      const result = await api<SubmissionResult>(`/api/submissions/${detail.id}/grade`, {
        method: "POST",
        json: { essay_text: essay },
      });
      setDetail({ ...detail, essay_text: essay, status: "graded", result, last_error_code: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Steps isTask1={isTask1} step={step} />
      <h1 className="page-title">{TASK_TITLES[detail.task_type]}</h1>

      {step === "prompt" && (
        <PromptStep
          detail={detail}
          promptText={promptText}
          onPromptText={setPromptText}
          onImage={(url) => setDetail({ ...detail, prompt_image_url: url })}
          error={error}
          busy={busy !== null}
          primary={
            isTask1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-primary" disabled={busy !== null} onClick={onExtract}>
                  Baca data grafik
                </button>
                {busy === "extract" && <span className="text-muted">Sedang membaca grafik… biasanya 10–30 detik</span>}
              </div>
            ) : (
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={onTask2Next}>
                Lanjut
              </button>
            )
          }
        />
      )}

      {step === "confirm" && detail.extracted_data && (
        <ConfirmStep
          key={detail.extracted_data ? JSON.stringify(detail.extracted_data) : "none"}
          detail={detail}
          busy={busy}
          error={error}
          onReextract={onExtract}
          onConfirm={onConfirm}
        />
      )}

      {step === "answer" && (
        <AnswerStep
          detail={detail}
          essay={essay}
          onEssay={setEssay}
          grading={busy === "grade"}
          error={error}
          onGrade={onGrade}
          onBack={isTask1 ? undefined : () => setTask2Answering(false)}
        />
      )}

      {step === "result" && detail.result && (
        <>
          <ResultView
            result={detail.result}
            polishAction={
              detail.result.polish_target !== null && (
                <button type="button" className="btn-primary" disabled={busy !== null} onClick={onPolish}>
                  Lihat versi polished (target band {band1(detail.result.polish_target)})
                </button>
              )
            }
            reviseAction={
              <button type="button" className="btn-secondary" disabled={busy !== null} onClick={onRevise}>
                Revisi & nilai ulang
              </button>
            }
          />
          <ErrorBanner message={error} />
          {busy === "polish" && <p className="text-muted">Sedang menulis ulang… biasanya 30–90 detik</p>}
          {showPolished && detail.polished && <PolishedPanel polished={detail.polished} />}
          {afterResult}
        </>
      )}
    </div>
  );
}

function Steps({ isTask1, step }: { isTask1: boolean; step: string }) {
  const steps = isTask1
    ? [
        ["prompt", "Soal"],
        ["confirm", "Konfirmasi data"],
        ["answer", "Jawaban"],
        ["result", "Hasil"],
      ]
    : [
        ["prompt", "Soal"],
        ["answer", "Jawaban"],
        ["result", "Hasil"],
      ];
  const current = steps.findIndex(([k]) => k === step);
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {steps.map(([k, label], i) => (
        <li
          key={k}
          className={`rounded-full px-3 py-1 font-semibold shadow-sm ${
            i === current ? "bg-primary text-white" : i < current ? "bg-primary-soft text-primary-dark" : "bg-white text-muted"
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function PromptStep(props: {
  detail: SubmissionDetail;
  promptText: string;
  onPromptText: (v: string) => void;
  onImage: (url: string | null) => void;
  error: string | null;
  busy: boolean;
  primary: React.ReactNode;
}) {
  const { detail } = props;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="prompt" className="label">
          Teks soal
        </label>
        <textarea
          id="prompt"
          className="input min-h-32"
          maxLength={5000}
          value={props.promptText}
          onChange={(e) => props.onPromptText(e.target.value)}
          placeholder="Tempel teks soal di sini."
        />
      </div>
      <div>
        <p className="label">
          Gambar soal {detail.task_type === "task1_academic" ? "(wajib)" : "(opsional)"}
        </p>
        <ImageInput submissionId={detail.id} imageUrl={detail.prompt_image_url} onChange={props.onImage} />
      </div>
      <ErrorBanner message={props.error} />
      {props.primary}
    </div>
  );
}

function AnswerStep(props: {
  detail: SubmissionDetail;
  essay: string;
  onEssay: (v: string) => void;
  grading: boolean;
  error: string | null;
  onGrade: () => void;
  onBack?: () => void;
}) {
  const { detail, essay } = props;
  const min = MIN_WORDS[detail.task_type];
  const wc = useMemo(() => countWords(essay, detail.prompt_text), [essay, detail.prompt_text]);

  // Autosave draf 2 detik setelah berhenti mengetik.
  const lastSaved = useRef(detail.essay_text);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (essay === lastSaved.current || props.grading) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        await api(`/api/submissions/${detail.id}`, { method: "PATCH", json: { essay_text: essay } });
        lastSaved.current = essay;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [essay, detail.id, props.grading]);

  return (
    <div className="space-y-4">
      <details className="card" open>
        <summary className="cursor-pointer font-semibold">Soal</summary>
        <div className="mt-3 space-y-3">
          {detail.prompt_text && <p className="whitespace-pre-wrap">{detail.prompt_text}</p>}
          {detail.prompt_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.prompt_image_url} alt="Gambar soal" className="max-h-80 w-full rounded-xl object-contain" />
          )}
        </div>
      </details>

      <div>
        <label htmlFor="essay" className="label">
          Jawaban
        </label>
        <textarea
          id="essay"
          className="input min-h-[360px] text-[16px] leading-[1.7]"
          maxLength={10000}
          value={essay}
          disabled={props.grading}
          onChange={(e) => props.onEssay(e.target.value)}
          placeholder="Tulis jawabanmu dalam bahasa Inggris."
        />
        <div className="mt-1 flex flex-wrap justify-between gap-2 text-sm">
          <p className={wc.counted < min ? "font-semibold text-danger" : "text-muted"}>
            Kata: {wc.counted} / minimal {min}
            {wc.excluded > 0 && ` (${wc.excluded} kata salinan dari soal tidak dihitung)`}
          </p>
          <p className="text-muted">
            {saveState === "saving" && "Menyimpan draf…"}
            {saveState === "saved" && "Draf tersimpan"}
            {saveState === "error" && "Draf gagal disimpan"}
          </p>
        </div>
      </div>

      <ErrorBanner message={props.error} />
      <div className="flex flex-wrap items-center gap-3">
        {props.onBack && (
          <button type="button" className="btn-secondary" onClick={props.onBack} disabled={props.grading}>
            Kembali ke soal
          </button>
        )}
        <button type="button" className="btn-primary" onClick={props.onGrade} disabled={props.grading}>
          Nilai jawaban
        </button>
        {props.grading && <span className="text-muted">Sedang menilai… biasanya 15–40 detik</span>}
      </div>
    </div>
  );
}

function ConfirmStep(props: {
  detail: SubmissionDetail;
  busy: string | null;
  error: string | null;
  onReextract: () => void;
  onConfirm: (d: ExtractedData) => void;
}) {
  const { detail } = props;
  const [data, setData] = useState<ExtractedData>(detail.extracted_data!);
  const mismatch = !!detail.extraction_uncertain && !Array.isArray(detail.extraction_uncertain);
  return (
    <div className="space-y-4">
      {mismatch && <p className="banner-warning">Grafik ini sulit dibaca. Cek semua angka dengan teliti.</p>}
      <p className="text-sm text-muted">
        Periksa data hasil bacaan grafik. Data ini dipakai untuk mengecek ketepatan angka di jawabanmu. Sel kuning
        berarti dua kali pembacaan memberi hasil berbeda.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {detail.prompt_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.prompt_image_url} alt="Gambar soal" className="w-full rounded-2xl object-contain shadow-card" />
          )}
        </div>
        <ExtractionEditor value={data} uncertain={detail.extraction_uncertain} onChange={setData} disabled={props.busy !== null} />
      </div>
      <ErrorBanner message={props.error} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={props.busy !== null} onClick={props.onReextract}>
          Baca ulang
        </button>
        <button type="button" className="btn-primary" disabled={props.busy !== null} onClick={() => props.onConfirm(data)}>
          Data sudah benar, lanjut
        </button>
        {props.busy === "extract" && <span className="text-muted">Sedang membaca grafik… biasanya 10–30 detik</span>}
      </div>
    </div>
  );
}
