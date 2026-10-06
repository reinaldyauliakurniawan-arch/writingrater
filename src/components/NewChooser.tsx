"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ErrorBanner from "./ErrorBanner";

type Usage = Record<"grade" | "polish" | "extract", { used: number; limit: number }>;

const CARDS = [
  { key: "task1_academic", title: "Task 1 Academic", desc: "Deskripsikan grafik, tabel, diagram, atau peta. Minimal 150 kata." },
  { key: "task2", title: "Task 2", desc: "Esai argumen atau opini. Minimal 250 kata." },
  { key: "session", title: "Sesi Writing lengkap (Task 1 + Task 2)", desc: "Kerjakan kedua task dan dapatkan skor Writing gabungan." },
] as const;

export default function NewChooser() {
  const router = useRouter();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setUsage(j?.data ?? null))
      .catch(() => setUsage(null));
  }, []);

  async function choose(key: (typeof CARDS)[number]["key"]) {
    setBusy(key);
    setError(null);
    const isSession = key === "session";
    const res = await fetch(isSession ? "/api/sessions" : "/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isSession ? {} : { task_type: key }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.data?.id) {
      setError(json?.error?.message ?? "Gagal membuat latihan baru.");
      setBusy(null);
      return;
    }
    router.push(isSession ? `/sessions/${json.data.id}` : `/submissions/${json.data.id}`);
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {CARDS.map((c) => (
        <button key={c.key} type="button" disabled={busy !== null} onClick={() => choose(c.key)}
          className={`card-click block w-full text-left ${busy === c.key ? "bg-primary-soft" : ""}`}>
          <span className="block text-lg font-bold text-primary-dark">{c.title}</span>
          <span className="mt-1 block text-muted">{c.desc}</span>
        </button>
      ))}
      {usage && (
        <div className="card text-sm">
          <p className="mb-2 font-semibold">Sisa kuota hari ini</p>
          <ul className="space-y-1 text-muted">
            <li>Penilaian: {Math.max(0, usage.grade.limit - usage.grade.used)} dari {usage.grade.limit}</li>
            <li>Versi polished: {Math.max(0, usage.polish.limit - usage.polish.used)} dari {usage.polish.limit}</li>
            <li>Ekstraksi gambar: {Math.max(0, usage.extract.limit - usage.extract.used)} dari {usage.extract.limit}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
