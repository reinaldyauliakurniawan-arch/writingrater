/* Transkripsi Speaking di browser (PRD Speaking.md). Audio tidak pernah dikirim ke server:
   model Whisper diunduh sekali dari CDN lalu dijalankan di perangkat ini.
   Whisper (MIT) + transformers.js (Apache 2.0). */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = "onnx-community/whisper-base.en";
const DTYPE = {
  webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  wasm: "q8",
};

let asr = null;
let device = null;

const progress = (p) => postMessage({
  type: "progress",
  status: p.status,
  file: p.file ?? null,
  loaded: p.loaded ?? null,
  total: p.total ?? null,
});

async function create(dev) {
  return pipeline("automatic-speech-recognition", MODEL, { device: dev, dtype: DTYPE[dev], progress_callback: progress });
}

/** Coba kartu grafis (WebGPU) dulu; kalau gagal, pakai prosesor (WASM). */
async function load(prefer) {
  if (asr) return;
  if (prefer === "webgpu") {
    try {
      asr = await create("webgpu");
      device = "webgpu";
      // Pemanasan: menyiapkan shader sekarang, bukan saat transkripsi pertama.
      await asr(new Float32Array(16000), { chunk_length_s: 30 });
      return;
    } catch (e) {
      postMessage({ type: "log", message: `WebGPU tidak bisa dipakai (${e?.message ?? e}), pindah ke prosesor.` });
      asr = null;
    }
  }
  asr = await create("wasm");
  device = "wasm";
}

async function run(audio) {
  return asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      await load(m.prefer);
      postMessage({ type: "ready", device });
      return;
    }
    if (m.type === "transcribe") {
      await load(m.prefer);
      const t0 = performance.now();
      let out;
      try {
        out = await run(m.audio);
      } catch (err) {
        if (device !== "webgpu") throw err;
        // Kartu grafis gagal di tengah jalan (sering di laptop grafis bawaan): ulangi di prosesor.
        postMessage({ type: "log", message: `WebGPU gagal saat transkripsi (${err?.message ?? err}), pindah ke prosesor.` });
        asr = null;
        await load("wasm");
        out = await run(m.audio);
      }
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out?.text ?? "").replace(/\s+/g, " ").trim();
      postMessage({ type: "result", id: m.id, text, ms: performance.now() - t0, device });
    }
  } catch (err) {
    postMessage({ type: "error", id: m.id ?? null, message: String(err?.message ?? err) });
  }
};
