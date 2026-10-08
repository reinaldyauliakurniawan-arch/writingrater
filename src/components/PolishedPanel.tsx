"use client";

import { useState } from "react";
import { band1 } from "@/lib/format";
import type { PolishedView } from "@/lib/types";
import CriteriaBlocks from "./CriteriaBlocks";

/** Versi polished di bawah hasil (bagian 8.3). */
export default function PolishedPanel({ polished }: { polished: PolishedView }) {
  const [copied, setCopied] = useState(false);

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
    <section className="card space-y-4">
      <h2 className="text-xl font-bold">
        Versi polished — target band{" "}
        <span className="rounded-lg bg-accent px-2 text-ink shadow-sm">{band1(polished.target_band)}</span>
      </h2>
      <div className="space-y-3 leading-[1.7]">
        {polished.polished_text.split(/\n\s*\n/).map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p.trim()}
          </p>
        ))}
      </div>
      <p className="font-semibold">Skor ulang versi ini: {band1(polished.rescored_task_band)}</p>
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
