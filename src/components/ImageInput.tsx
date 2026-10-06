"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/apiClient";
import ErrorBanner from "./ErrorBanner";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  submissionId: string;
  imageUrl: string | null;
  disabled?: boolean;
  onChange: (url: string | null) => void;
};

/** Area gambar soal: klik pilih file, drag-and-drop, atau paste. Upload langsung saat dipilih. */
export default function ImageInput({ submissionId, imageUrl, disabled, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [version, setVersion] = useState(0); // cache-buster preview

  async function upload(file: File) {
    setError(null);
    if (!ACCEPT.includes(file.type) || file.size > MAX_BYTES) {
      setError("Gambar harus PNG, JPG, atau WEBP dan maksimal 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await api<{ prompt_image_url: string }>(`/api/submissions/${submissionId}/image`, {
        method: "POST",
        body: fd,
      });
      setVersion((v) => v + 1);
      onChange(data.prompt_image_url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/submissions/${submissionId}/image`, { method: "DELETE" });
      onChange(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Paste gambar dari clipboard di mana saja pada halaman.
  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, submissionId]);

  return (
    <div className="space-y-2">
      {imageUrl ? (
        <div className="card space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${imageUrl}?v=${version}`} alt="Gambar soal" className="max-h-96 w-full rounded-xl object-contain" />
          {!disabled && (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                Ganti gambar
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>
                Hapus gambar
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={`flex min-h-32 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center shadow-inner transition duration-150 ${
            dragOver ? "border-primary bg-primary-soft" : "border-line bg-white hover:border-primary"
          }`}
        >
          <span className="font-semibold text-primary-dark">{busy ? "Mengunggah…" : "Pilih gambar soal"}</span>
          <span className="mt-1 text-sm text-muted">Klik, seret file ke sini, atau tempel (Ctrl+V). PNG, JPG, WEBP, maks. 5 MB.</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <ErrorBanner message={error} />
    </div>
  );
}
