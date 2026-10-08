"use client";

import { useState } from "react";
import { band1 } from "@/lib/format";
import { toSegments, type CorrectionType } from "@/lib/corrections";
import type { PolishedView } from "@/lib/types";
import CriteriaBlocks from "./CriteriaBlocks";

const TYPE_STYLE: Record<CorrectionType, { label: string; mark: string; dot: string }> = {
  content: { label: "Konten", mark: "bg-[#ede9fe] decoration-[#7c3aed]", dot: "bg-[#7c3aed]" },
  data: { label: "Data", mark: "bg-[#fee2e2] decoration-[#dc2626]", dot: "bg-[#dc2626]" },
  cohesion: { label: "Koherensi & kohesi", mark: "bg-[#fce7f3] decoration-[#db2777]", dot: "bg-[#db2777]" },
  vocab: { label: "Kosakata", mark: "bg-[#dbeafe] decoration-[#2563eb]", dot: "bg-[#2563eb]" },
  grammar: { label: "Grammar", mark: "bg-[#fef3c7] decoration-[#d97706]", dot: "bg-[#d97706]" },
};

/** Kelompok legenda per kriteria penilaian. */
function legendGroups(task: PolishedView["task_type"]): { criterion: string; types: CorrectionType[] }[] {
  return [
    { criterion: task === "task1_academic" ? "Task Achievement" : "Task Response", types: task === "task1_academic" ? ["content", "data"] : ["content"] },
    { criterion: "Coherence & Cohesion", types: ["cohesion"] },
    { criterion: "Lexical Resource", types: ["vocab"] },
    { criterion: "Grammatical Range & Accuracy", types: ["grammar"] },
  ];
}

/** Esai asli dengan sorotan kesalahan; keterangan muncul saat hover (desktop) atau tap (HP). */
function MarkedOriginal({ polished }: { polished: PolishedView }) {
  const segments = toSegments(polished.original_text, polished.original_marks);
  return (
    <div className="whitespace-pre-wrap leading-[1.9]">
      {segments.map((s, i) => {
        if (!s.mark) return <span key={i}>{s.text}</span>;
        const style = TYPE_STYLE[s.mark.type];
        return (
          <span
            key={i}
            tabIndex={0}
            className={`group relative cursor-help rounded-sm underline decoration-2 underline-offset-4 outline-none focus:ring-2 focus:ring-primary ${style.mark}`}
          >
            {s.text}
            <span
              role="tooltip"
              className="pointer-events-none absolute top-full left-1/2 z-20 mt-2 hidden w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-left text-sm leading-normal whitespace-normal text-white shadow-card group-hover:block group-focus:block"
            >
              <span className="mb-1 flex items-center gap-1.5 font-bold">
                <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              <span className="block">{s.mark.issue}</span>
              <span className="mt-1 block">
                Seharusnya: <span className="font-semibold text-accent">{s.mark.correction}</span>
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Versi polished di bawah hasil (bagian 8.3): esai asli bertanda di kiri, versi polished di kanan. */
export default function PolishedPanel({ polished }: { polished: PolishedView }) {
  const [copied, setCopied] = useState(false);
  const count = (t: CorrectionType) => polished.original_marks.filter((m) => m.type === t).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(polished.polished_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card space-y-4 lg:relative lg:left-1/2 lg:w-[min(1080px,calc(100vw-2rem))] lg:-translate-x-1/2">
      <h2 className="text-xl font-bold">
        Versi polished — target band{" "}
        <span className="rounded-lg bg-accent px-2 text-ink shadow-sm">{band1(polished.target_band)}</span>
      </h2>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="font-bold">Tulisan kamu</h3>
          {polished.has_corrections ? (
            <ul className="space-y-1 text-sm text-muted">
              {legendGroups(polished.task_type).map((g) => (
                <li key={g.criterion} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-ink">{g.criterion}:</span>
                  {g.types.map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${TYPE_STYLE[t].dot}`} />
                      {TYPE_STYLE[t].label} ({count(t)})
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="banner-warning text-sm">
              Versi polished ini dibuat sebelum penanda kesalahan lengkap ada
              {polished.original_marks.length > 0 ? ", jadi hanya kesalahan data yang ditandai" : ""}. Untuk melihat
              kesalahan konten, koherensi, kosakata, dan grammar, pakai &quot;Revisi &amp; nilai ulang&quot; lalu buka
              versi polished yang baru.
            </p>
          )}
          {polished.original_marks.length > 0 && (
            <p className="text-sm text-muted">Arahkan kursor (atau ketuk) bagian yang disorot untuk melihat koreksinya.</p>
          )}
          <div className="rounded-xl border border-line p-4">
            <MarkedOriginal polished={polished} />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-bold">Versi polished</h3>
          <p className="text-sm text-muted">Skor ulang versi ini: {band1(polished.rescored_task_band)}</p>
          <div className="space-y-3 rounded-xl border border-primary bg-primary-soft p-4 leading-[1.9]">
            {polished.polished_text.split(/\n\s*\n/).map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p.trim()}
              </p>
            ))}
          </div>
        </div>
      </div>

      <details>
        <summary className="cursor-pointer font-semibold">Lihat penilaian versi polished</summary>
        <div className="mt-3">
          <CriteriaBlocks criteria={polished.rescored_criteria} />
        </div>
      </details>
      <button type="button" className="btn-secondary" onClick={copy}>
        {copied ? "Tersalin" : "Salin esai"}
      </button>
    </section>
  );
}
