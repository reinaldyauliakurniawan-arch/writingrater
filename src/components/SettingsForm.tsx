"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/apiClient";
import { formatDate } from "@/lib/format";
import ErrorBanner from "./ErrorBanner";

export type PublicSettings = {
  provider: string | null;
  model: string | null;
  base_url: string | null;
  api_key_last4: string | null;
  has_api_key: boolean;
  last_test_ok: boolean | null;
  last_test_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  source: "database" | "env" | "none";
};

export type ProviderOption = { value: string; label: string; modelPlaceholder: string; needsBaseUrl: boolean };

type TestResult = { ok: boolean; latency_ms: number; error?: string };

export default function SettingsForm({ initial, providers }: { initial: PublicSettings; providers: ProviderOption[] }) {
  const [saved, setSaved] = useState(initial);
  const [provider, setProvider] = useState(initial.provider ?? providers[0].value);
  const [model, setModel] = useState(initial.model ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<(TestResult & { signature: string }) | null>(null);
  const [busy, setBusy] = useState<null | "test" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const opt = providers.find((p) => p.value === provider) ?? providers[0];
  const signature = JSON.stringify([provider, model.trim(), opt.needsBaseUrl ? baseUrl.trim() : "", apiKey.trim()]);
  // Sama dengan aturan server: tes wajib kalau key baru diisi, atau key tersimpan dan provider/model/base URL berubah.
  const llmFieldsChanged =
    provider !== saved.provider ||
    model.trim() !== (saved.model ?? "") ||
    (opt.needsBaseUrl ? baseUrl.trim() : null) !== (saved.base_url ?? null);
  const llmChanged = apiKey.trim() !== "" || (saved.has_api_key && llmFieldsChanged);
  const testPassed = test?.ok === true && test.signature === signature;
  const canSave = busy === null && (!llmChanged || testPassed);
  const modelSwitched = saved.source !== "none" && (provider !== saved.provider || model.trim() !== (saved.model ?? ""));

  const llmBody = () => ({
    provider,
    model: model.trim(),
    base_url: opt.needsBaseUrl ? baseUrl.trim() : null,
    api_key: apiKey.trim() || null,
  });

  async function runTest() {
    setError(null);
    setNotice(null);
    setBusy("test");
    const sig = signature;
    try {
      const r = await api<TestResult>("/api/settings/test", { method: "POST", json: llmBody() });
      setTest({ ...r, signature: sig });
    } catch (e) {
      setTest({ ok: false, latency_ms: 0, error: errorMessage(e), signature: sig });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setNotice(null);
    setBusy("save");
    try {
      const s = await api<PublicSettings>("/api/settings", {
        method: "PUT",
        json: llmBody(),
      });
      setSaved(s);
      setApiKey("");
      setTest(null);
      setNotice("Pengaturan disimpan dan langsung berlaku.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card text-sm">
        <p className="font-semibold">Pengaturan aktif</p>
        {saved.source === "none" ? (
          <p className="mt-1 text-muted">Belum dikonfigurasi (database dan env kosong).</p>
        ) : (
          <ul className="mt-1 space-y-1 text-muted">
            <li>
              Model: <span className="font-semibold text-ink">{`${saved.provider}:${saved.model}`}</span>
            </li>
            <li>Sumber: {saved.source}</li>
            {saved.updated_at && (
              <li>
                Terakhir diubah oleh {saved.updated_by ?? "-"} pada {formatDate(saved.updated_at)}
              </li>
            )}
          </ul>
        )}
      </div>

      <form
        className="card space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <div>
          <label htmlFor="provider" className="label">
            Provider
          </label>
          <select id="provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="model" className="label">
            Model
          </label>
          <input
            id="model"
            className="input"
            maxLength={200}
            value={model}
            placeholder={opt.modelPlaceholder}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="mt-1 text-sm text-muted">Model wajib bisa membaca gambar.</p>
        </div>

        {opt.needsBaseUrl && (
          <div>
            <label htmlFor="baseUrl" className="label">
              Base URL
            </label>
            <input
              id="baseUrl"
              className="input"
              maxLength={500}
              value={baseUrl}
              placeholder="https://..."
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}

        <div>
          <label htmlFor="apiKey" className="label">
            API key
          </label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            className="input"
            value={apiKey}
            placeholder={
              saved.has_api_key && saved.api_key_last4
                ? `•••• ${saved.api_key_last4} (kosongkan untuk tetap memakai key ini)`
                : ""
            }
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <button type="button" className="btn-secondary" disabled={busy !== null || !model.trim()} onClick={runTest}>
            {busy === "test" ? "Menguji…" : "Tes koneksi"}
          </button>
          {test && test.signature === signature && (
            test.ok ? (
              <p className="inline-block rounded-lg bg-accent px-3 py-1 font-semibold text-ink shadow-sm">
                Berhasil ({test.latency_ms} ms)
              </p>
            ) : (
              <p className="banner-error">{test.error}</p>
            )
          )}
        </div>

        {modelSwitched && (
          <p className="banner-warning">
            Mengganti model bisa mengubah hasil skor. Jalankan ulang <code>npm run calibrate</code> setelah menyimpan.
          </p>
        )}

        <ErrorBanner message={error} />
        {notice && <p className="font-semibold text-primary-dark">{notice}</p>}

        <button type="submit" className="btn-primary" disabled={!canSave}>
          {busy === "save" ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
    </div>
  );
}
