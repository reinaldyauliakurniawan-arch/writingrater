"use client";

import { useState } from "react";
import { band1, resultCopyText } from "@/lib/format";
import type { SubmissionResult } from "@/lib/types";
import CriteriaBlocks from "./CriteriaBlocks";

type Props = {
  result: SubmissionResult;
  /** Tombol "Lihat versi polished" (sebelum Salin hasil). */
  polishAction?: React.ReactNode;
  /** Tombol "Revisi & nilai ulang" (sesudah Salin hasil). */
  reviseAction?: React.ReactNode;
  children?: React.ReactNode;
};

export default function ResultView({ result, polishAction, reviseAction, children }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(resultCopyText(result.criteria, result.task_band));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const factErrors = result.fact_errors ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Jumlah kata: {result.word_count.counted} (minimal {result.word_count.min})
      </p>

      <CriteriaBlocks criteria={result.criteria} />

      <p className="text-[24px] font-bold">
        Overall: <span className="rounded-lg bg-accent px-2 text-ink shadow-sm">{band1(result.task_band)}</span>
      </p>

      {result.task_type === "task1_academic" && factErrors.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">
            Kesalahan data yang ditemukan ({factErrors.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {factErrors.map((f, i) => (
              <li key={i} className="rounded-xl border border-line p-3">
                <p className="italic">“{f.essay_quote}”</p>
                <p className="mt-1">
                  <span className="font-semibold">Masalah:</span> {f.issue}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Data yang benar:</span> {f.correct_info}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-sm text-muted">
        Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS.
      </p>

      <div className="flex flex-wrap gap-2">
        {polishAction}
        <button type="button" className="btn-secondary" onClick={copy}>
          {copied ? "Tersalin" : "Salin hasil"}
        </button>
        {reviseAction}
      </div>

      {children}
    </div>
  );
}
