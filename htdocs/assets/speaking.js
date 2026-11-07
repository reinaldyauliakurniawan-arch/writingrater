/* IELTS Speaking (PRD Speaking.md): cek perangkat, rekam, transkripsi di browser, penilaian, laporan.
   Memakai utilitas dari app.js (h, api, setChildren, copyRich, ...). Audio tidak pernah dikirim ke server. */
"use strict";

// ---------------------------------------------------------------- penyimpanan kecil di browser

const SP_STORE = { check: "speakingCheck", loading: "speakingModelLoading", mic: "speakingMic", modelReady: "speakingModelReady" };

function spGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function spSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* penyimpanan browser tidak tersedia */
  }
}

const PART_NAMES = { p1: "Part 1", p2: "Part 2", p3: "Part 3" };

const isMobileDevice = () =>
  navigator.userAgentData?.mobile === true ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && !matchMedia("(pointer: fine)").matches);

// ---------------------------------------------------------------- Whisper (Web Worker)

const Whisper = {
  worker: null,
  device: null,
  readyPromise: null,
  jobs: new Map(),
  seq: 0,
  chain: Promise.resolve(),
  listeners: new Set(),
  files: {},

  /** Kartu grafis hanya dipakai kalau browser benar-benar memberi adapter WebGPU. */
  async prefer() {
    try {
      if (navigator.gpu && (await navigator.gpu.requestAdapter())) return "webgpu";
    } catch {
      /* tidak ada kartu grafis yang bisa dipakai */
    }
    return "wasm";
  },

  emit(ev) {
    this.listeners.forEach((fn) => fn(ev));
  },

  start() {
    if (this.worker) return;
    this.files = {};
    // Worker dibuat lewat blob yang meng-import file worker: worker blob mewarisi status "cross-origin
    // isolated" halaman, sehingga transkripsi bisa memakai banyak inti prosesor.
    const ver = document.querySelector('script[src*="speaking.js"]')?.src.split("?v=")[1] ?? "";
    const src = new URL(`/assets/whisper-worker.js?v=${ver}`, location.href).href;
    try {
      const blob = new Blob([`import ${JSON.stringify(src)};`], { type: "text/javascript" });
      this.worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    } catch {
      this.worker = new Worker(src, { type: "module" });
    }
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.fail(e.message || "Alat transkripsi gagal dimuat. Periksa koneksi internet.");
    };
  },

  stop() {
    this.worker?.terminate();
    this.worker = null;
  },

  fail(message) {
    const err = new Error(message);
    this.readyReject?.(err);
    this.readyReject = null;
    this.jobs.forEach((j) => j.reject(err));
    this.jobs.clear();
    this.stop();
    // Worker mati setelah model siap (mis. kehabisan memori): transkripsi berikutnya memuat ulang.
    if (this.loaded) this.readyPromise = null;
    this.loaded = false;
  },

  /** Satu percobaan memuat model di worker baru. */
  loadOnce(prefer, single = false) {
    this.start();
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.worker.postMessage({ type: "load", prefer, single });
    });
  },

  onMessage(m) {
    if (m.type === "progress") {
      if (m.file && m.total) this.files[m.file] = { loaded: m.loaded ?? 0, total: m.total };
      if (m.file && m.status === "done" && this.files[m.file]) this.files[m.file].loaded = this.files[m.file].total;
      const all = Object.values(this.files);
      const total = all.reduce((s, f) => s + f.total, 0);
      const loaded = all.reduce((s, f) => s + f.loaded, 0);
      this.emit({ type: "progress", loaded, total });
    } else if (m.type === "ready") {
      this.device = m.device;
      this.threads = m.threads ?? null;
      this.loaded = true;
      spSet(SP_STORE.loading, null);
      spSet(SP_STORE.modelReady, { at: Date.now(), device: m.device });
      this.readyResolve?.(m.device);
      this.emit({ type: "ready", device: m.device });
    } else if (m.type === "result") {
      this.device = m.device;
      const j = this.jobs.get(m.id);
      this.jobs.delete(m.id);
      j?.resolve(m);
    } else if (m.type === "error") {
      if (m.id !== null && this.jobs.has(m.id)) {
        const j = this.jobs.get(m.id);
        this.jobs.delete(m.id);
        j.reject(new Error(m.message));
      } else {
        this.fail(m.message);
      }
    } else if (m.type === "log") {
      this.emit({ type: "log", message: m.message });
    }
  },

  /**
   * Muat model (sekali). Kartu grafis dulu; kalau gagal, worker baru dengan prosesor (status ONNX di worker
   * lama bisa rusak setelah WebGPU gagal). Menandai "sedang memuat" supaya crash tab terdeteksi saat dibuka lagi.
   */
  load() {
    if (this.readyPromise) return this.readyPromise;
    spSet(SP_STORE.loading, Date.now());
    this.readyPromise = (async () => {
      const prefer = this.forceSingle ? "wasm" : await this.prefer();
      let lastError = null;
      // Urutan percobaan: kartu grafis -> prosesor banyak inti -> prosesor satu inti (paling aman).
      const attempts = prefer === "webgpu" ? [["webgpu", false], ["wasm", false]] : [["wasm", !!this.forceSingle]];
      if (window.crossOriginIsolated && !this.forceSingle) attempts.push(["wasm", true]);
      for (const [dev, single] of attempts) {
        try {
          return await this.loadOnce(dev, single);
        } catch (e) {
          lastError = e;
          this.stop();
          this.emit({ type: "log", message: dev === "webgpu" ? "Kartu grafis tidak bisa dipakai, pindah ke prosesor…" : "Mencoba ulang dengan pengaturan prosesor paling aman…" });
        }
      }
      throw lastError;
    })();
    this.readyPromise.catch((e) => {
      spSet(SP_STORE.loading, null);
      this.readyPromise = null;
      this.emit({ type: "error", message: friendlyWhisperError(e.message) });
    });
    return this.readyPromise;
  },

  /** Antrean satu per satu. audio: Float32Array 16 kHz mono. */
  transcribe(audio) {
    const send = async (data) => {
      const device = await this.load();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        this.worker.postMessage({ type: "transcribe", id, audio: data, prefer: device }, [data.buffer]);
      });
    };
    const run = async () => {
      // Salinan cadangan hanya saat memakai banyak inti: kalau gagal, ulangi dengan satu inti.
      const backup = (this.threads ?? 1) > 1 ? audio.slice() : null;
      try {
        return await send(audio);
      } catch (e) {
        if (!backup) throw e;
        this.emit({ type: "log", message: "Transkripsi diulang dengan pengaturan prosesor paling aman…" });
        this.forceSingle = true;
        this.stop();
        this.readyPromise = null;
        this.loaded = false;
        return await send(backup);
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  },
};

/** Pesan teknis dari worker -> bahasa awam (detail teknis tetap disertakan di akhir). */
function friendlyWhisperError(msg) {
  const m = String(msg ?? "");
  if (/fetch|network|Failed to load|import|404|ERR_/i.test(m) && !/backend/i.test(m)) {
    return `Alat transkripsi gagal diunduh. Periksa koneksi internet (situs cdn.jsdelivr.net dan huggingface.co tidak boleh diblokir), lalu coba lagi. (${m})`;
  }
  if (/memory|allocation|OOM/i.test(m)) return `Memori perangkat tidak cukup. Tutup tab/aplikasi lain lalu coba lagi, atau pakai laptop lain. (${m})`;
  return `Alat transkripsi tidak bisa dijalankan di perangkat ini. (${m})`;
}

/** Model sudah pernah diunduh ke browser ini (Cache Storage transformers.js). */
async function modelCached() {
  try {
    if (!("caches" in window)) return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes("whisper-base.en") && r.url.includes(".onnx"));
  } catch {
    return false;
  }
}

/** Tab mati saat memuat model sebelumnya (tanda "sedang memuat" tertinggal). */
function loadCrashedBefore() {
  const t = spGet(SP_STORE.loading);
  return typeof t === "number" && Date.now() - t > 5000;
}

// ---------------------------------------------------------------- audio

/** Rekaman (Blob) -> Float32Array 16 kHz mono untuk Whisper. */
async function blobToPcm16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const ab = await ctx.decodeAudioData(buf);
    const n = ab.numberOfChannels;
    if (n === 1) return new Float32Array(ab.getChannelData(0));
    const out = new Float32Array(ab.length);
    for (let c = 0; c < n; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
    }
    return out;
  } finally {
    ctx.close();
  }
}

async function openMic() {
  const saved = spGet(SP_STORE.mic);
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (saved) audio.deviceId = { ideal: saved };
  return navigator.mediaDevices.getUserMedia({ audio });
}

/** Indikator volume. Mengembalikan fungsi stop. */
function levelMeter(stream, bar) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const data = new Uint8Array(an.fftSize);
  let raf = 0;
  let peak = 0;
  const tick = () => {
    an.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / data.length);
    const level = Math.min(1, rms * 4);
    peak = Math.max(peak, level);
    bar.style.width = `${Math.round(level * 100)}%`;
    raf = requestAnimationFrame(tick);
  };
  tick();
  return { stop: () => { cancelAnimationFrame(raf); ctx.close(); }, peak: () => peak };
}

/** Perekam satu Part. Memanggil onInterrupted kalau mic terputus di tengah rekaman. */
function startRecording(stream, { onInterrupted }) {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const started = Date.now();
  let stopping = false;
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => {
    rec.onstop = () => resolve({ blob: new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }), seconds: (Date.now() - started) / 1000 });
  });
  stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => {
    if (!stopping) onInterrupted?.();
  }));
  rec.onerror = () => onInterrupted?.();
  rec.start(1000);
  return {
    started,
    stop() {
      stopping = true;
      if (rec.state !== "inactive") rec.stop();
      return stopped;
    },
  };
}

let wakeLock = null;
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* tidak didukung / ditolak */
  }
}

// ---------------------------------------------------------------- tampilan umum

/** Ikon garis (Lucide, MIT) sebagai SVG inline. Dekoratif: teks di sebelahnya yang menjelaskan. */
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
};

function icon(name, size = 18, cls = "") {
  const span = document.createElement("span");
  span.className = `ico ${cls}`.trim();
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

/** Catatan kecil berikon (pengganti banner bertumpuk). kind: info | warn | error | ok */
function note(kind, iconName, ...children) {
  return h("div", { class: `sp-note ${kind}`, role: kind === "error" ? "alert" : null }, icon(iconName, 18), h("div", { class: "grow" }, ...children));
}

const SP_DEVICE_NOTE = "Pakai laptop atau komputer dengan mikrofon untuk hasil terbaik. HP/tablet boleh dicoba, tetapi bisa lambat.";
const SP_PRIVACY_SHORT = "Audio tidak disimpan dan tidak dikirim ke mana pun. Yang disimpan hanya transkrip dan nilai.";

function checkSummary(c) {
  if (!c) return { kind: "warn", text: "Perangkat ini belum dicek.", icon: "alert" };
  if (c.result === "green") return { kind: "ok", text: `Perangkat siap (dicek ${formatDateId(new Date(c.at).toISOString())}).`, icon: "check" };
  if (c.result === "yellow") return { kind: "warn", text: "Perangkat bisa dipakai, tapi transkripsi agak lambat.", icon: "alert" };
  return { kind: "error", text: "Perangkat ini tidak disarankan untuk ujian Speaking.", icon: "x" };
}

function fmtSec(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtWait(sec) {
  sec = Math.round(sec);
  return sec < 60 ? `±${sec} detik` : `±${Math.round(sec / 60)} menit`;
}

function wordsOf(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

function deviceLabel(device, threads) {
  if (device === "webgpu") return "kartu grafis";
  return threads && threads > 1 ? `prosesor (${threads} inti)` : "prosesor (1 inti)";
}

/** Soal satu Part. */
function partQuestion(set, part) {
  if (part === "p2") {
    const c = set.part2;
    return h("div", { class: "cue-card" },
      h("p", { class: "cue-title" }, c.title),
      h("p", { class: "cue-say" }, "You should say:"),
      h("ul", { class: "cue-points" }, c.points.map((p) => h("li", null, p))),
      h("p", { class: "cue-title", style: "margin-top:8px" }, c.final),
      h("p", { class: "small muted", style: "margin-top:16px" }, "1 menit persiapan (boleh membuat catatan), lalu berbicara 1–2 menit."));
  }
  const topics = set[part === "p1" ? "part1" : "part3"];
  return h("div", { class: "stack-lg" }, topics.map((t) =>
    h("div", { class: "sp-topic" },
      h("p", { class: "sp-topic-title" }, t.topic),
      t.intro ? h("p", { class: "italic muted small", style: "margin-top:4px" }, t.intro) : null,
      h("ul", { class: "sp-questions" }, t.questions.map((q) => h("li", null, q))))));
}

const pageHead = (title, subtitle, back) => h("div", { class: "sp-head" },
  back ? h("a", { href: back.href, class: "sp-back" }, icon("arrowLeft", 16), back.label) : null,
  h("h1", { class: "page-title" }, title),
  subtitle ? h("p", { class: "muted" }, subtitle) : null);

// ---------------------------------------------------------------- /speaking

function speakingHome(root, data) {
  const c = checkSummary(spGet(SP_STORE.check));
  const err = h("div");
  const studentInput = h("input", { class: "input", id: "sp-student", list: "sp-students", maxlength: "100", placeholder: "mis. Rina", autocomplete: "off" });
  const setSelect = h("select", { class: "input", id: "sp-set" }, data.sets.map((s) => h("option", { value: s.id }, s.name)));
  const cuePreview = h("p", { class: "small muted", style: "margin-top:6px" });
  const showCue = () => (cuePreview.textContent = `Part 2: ${data.sets.find((s) => s.id === setSelect.value)?.part2 ?? ""}`);
  setSelect.addEventListener("change", showCue);
  showCue();
  let mode = "full";
  const modeBox = h("div", { class: "sp-modes", role: "radiogroup", "aria-label": "Mode" });
  const drawModes = () => setChildren(modeBox, Object.entries(data.modes).map(([k, v]) =>
    h("button", { type: "button", role: "radio", "aria-checked": k === mode ? "true" : "false", class: `sp-mode${k === mode ? " active" : ""}`,
      onclick: () => { mode = k; drawModes(); } }, v)));
  drawModes();
  const startBtn = h("button", { type: "submit", class: "btn-primary btn-lg" }, icon("mic", 18), "Mulai ujian");

  const form = h("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    setChildren(err);
    startBtn.disabled = true;
    try {
      const r = await api("/api/speaking", { method: "POST", json: { student_name: studentInput.value, set_id: setSelect.value, mode } });
      location.href = `/speaking/${r.id}`;
    } catch (ex) {
      setChildren(err, errorBanner(errorMessage(ex)));
      startBtn.disabled = false;
    }
  } },
    h("h2", { class: "section-title", style: "margin:0" }, "Mulai ujian baru"),
    h("div", null, h("label", { class: "label", for: "sp-student" }, "Nama murid"), studentInput,
      h("datalist", { id: "sp-students" }, data.students.map((n) => h("option", { value: n })))),
    h("div", null, h("label", { class: "label", for: "sp-set" }, "Set soal"), setSelect, cuePreview),
    h("div", null, h("span", { class: "label" }, "Mode"), modeBox,
      h("p", { class: "small muted", style: "margin-top:6px" }, "Satu Part menghasilkan estimasi latihan. Mode lengkap menghasilkan skor simulasi.")),
    err,
    h("div", null, startBtn));

  const statusLabel = (t) => t.status === "final" ? h("span", { class: "sp-score" }, band1(t.overall))
    : h("span", { class: `chip${t.status === "review" ? "" : " chip-muted"}` }, t.status === "review" ? "Menunggu finalisasi" : "Belum selesai");
  const list = data.tests.length
    ? h("ul", { class: "sp-list" }, data.tests.map((t) =>
        h("li", null, h("a", { href: `/speaking/${t.id}` },
          h("span", { class: "grow", style: "min-width:0" },
            h("span", { class: "semibold truncate", style: "display:block" }, t.student_name ?? "Tanpa nama"),
            h("span", { class: "small muted truncate", style: "display:block" }, `${t.set_name} · ${t.mode_label} · ${t.created_at_text}`)),
          statusLabel(t)))))
    : h("p", { class: "muted small" }, "Belum ada ujian Speaking.");

  setChildren(root, h("div", { class: "stack-lg" },
    pageHead("Speaking", "Simulasi IELTS Speaking bersama examiner. AI membantu menilai Lexical Resource dan Grammar dari transkrip."),
    h("div", { class: "sp-home" },
      form,
      h("div", { class: "stack" },
        h("section", { class: "card stack-sm" },
          h("h2", { class: "section-title", style: "margin:0" }, "Perangkat"),
          note(c.kind, c.icon, c.text),
          h("a", { href: "/speaking/cek", class: "btn-secondary btn-block" }, c.kind === "ok" ? "Cek ulang perangkat" : "Cek perangkat"),
          h("p", { class: "small muted" }, SP_DEVICE_NOTE)),
        h("section", { class: "card stack-sm" },
          h("h2", { class: "section-title", style: "margin:0" }, "Ujian terakhir"),
          list),
        note("info", "shield", h("span", { class: "small" }, SP_PRIVACY_SHORT))))));
}

// ---------------------------------------------------------------- /speaking/cek

const SAMPLE_SENTENCE = "I usually spend my weekends with my family. We often visit my grandmother, who lives in a small village near the mountains.";

/** Bagian kalimat contoh yang muncul berurutan di hasil transkripsi (0–1). Kata tambahan di hasil tidak mengurangi. */
function similarity(sample, heard) {
  const norm = (s) => wordsOf(s.toLowerCase().replace(/[^a-z0-9' ]+/g, " "));
  const x = norm(sample);
  const y = norm(heard);
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return x.length ? prev[y.length] / x.length : 0;
}

function speakingCheck(root) {
  const st = {
    browser: null, mic: null, level: null, model: null, speed: null,
    micMsg: "", modelMsg: "", speedMsg: "", progress: null, transcript: null, devices: [],
  };
  let stream = null;
  let meter = null;
  const crashed = loadCrashedBefore();

  const missing = [];
  if (!window.isSecureContext) missing.push("koneksi aman (alamat harus diawali https://)");
  if (!navigator.mediaDevices?.getUserMedia) missing.push("akses mikrofon");
  if (!window.MediaRecorder) missing.push("perekam suara");
  if (!window.Worker) missing.push("Web Worker");
  if (typeof WebAssembly !== "object") missing.push("WebAssembly");
  if (!(window.AudioContext || window.webkitAudioContext)) missing.push("Web Audio");
  st.browser = missing.length ? "red" : "green";

  const levelBar = h("div", { class: "level-fill" });
  const box = h("ol", { class: "card sp-steps" });

  const STATUS_ICON = { green: "check", yellow: "alert", red: "x", loading: "loader" };
  const STATUS_TEXT = { green: "Lolos", yellow: "Perlu perhatian", red: "Bermasalah", loading: "Berjalan" };
  const step = (n, title, status, ...body) => h("li", { class: `sp-step ${status ?? "todo"}` },
    h("div", { class: "sp-step-mark" }, status && STATUS_ICON[status] ? icon(STATUS_ICON[status], 16, status === "loading" ? "spin" : "") : String(n)),
    h("div", { class: "grow stack-sm" },
      h("div", { class: "sp-step-head" }, h("h2", null, title), status && STATUS_TEXT[status] ? h("span", { class: "sr-only" }, ` — ${STATUS_TEXT[status]}`) : null),
      ...body));

  async function askMic() {
    st.micMsg = "";
    try {
      stream?.getTracks().forEach((t) => t.stop());
      meter?.stop();
      stream = await openMic();
      st.mic = "green";
      const all = await navigator.mediaDevices.enumerateDevices();
      st.devices = all.filter((d) => d.kind === "audioinput");
      meter = levelMeter(stream, levelBar);
      st.level = "loading";
      setTimeout(() => {
        st.level = meter && meter.peak() > 0.08 ? "green" : "red";
        draw();
      }, 4000);
    } catch (e) {
      st.mic = "red";
      st.micMsg = e?.name === "NotFoundError" ? "Tidak ada mikrofon yang terpasang." : "Izin mikrofon ditolak atau mikrofon sedang dipakai aplikasi lain.";
    }
    draw();
  }

  Whisper.listeners.add((ev) => {
    if (ev.type === "progress") st.progress = ev;
    if (ev.type === "error") {
      st.model = "red";
      st.modelMsg = ev.message;
    }
    if (ev.type === "log") st.modelMsg = ev.message;
    draw();
  });

  async function loadModel() {
    st.model = "loading";
    st.modelMsg = "";
    draw();
    try {
      const dev = await Whisper.load();
      st.model = "green";
      st.modelMsg = dev === "webgpu"
        ? "Siap. Memakai kartu grafis (cepat)."
        : `Siap. Memakai ${deviceLabel(dev, Whisper.threads)}. Kartu grafis tidak tersedia, jadi lebih lambat.`;
    } catch (e) {
      st.model = "red";
      st.modelMsg = friendlyWhisperError(e.message);
    }
    draw();
  }

  let speedRec = null;
  async function speedTest() {
    if (!stream) return;
    if (!speedRec) {
      speedRec = startRecording(stream, {});
      st.speed = "recording";
      draw();
      return;
    }
    const rec = speedRec;
    speedRec = null;
    st.speed = "working";
    draw();
    try {
      const { blob, seconds } = await rec.stop();
      const pcm = await blobToPcm16k(blob);
      const r = await Whisper.transcribe(pcm);
      const rtf = r.ms / 1000 / Math.max(1, seconds);
      const acc = similarity(SAMPLE_SENTENCE, r.text);
      st.transcript = r.text || "(tidak ada suara yang terdengar)";
      st.speed = rtf <= 0.5 ? "green" : rtf <= 1.5 ? "yellow" : "red";
      st.speedMsg = `Rekaman ${fmtSec(seconds)} selesai dalam ${(r.ms / 1000).toFixed(1)} detik memakai ${deviceLabel(r.device, Whisper.threads)}. `
        + `Perkiraan tunggu untuk jawaban 4 menit: ${fmtWait(rtf * 240)}. Ketepatan: ${Math.round(acc * 100)}%.`;
      spSet(SP_STORE.check, { at: Date.now(), result: st.speed === "green" && st.level !== "red" ? "green" : st.speed === "red" ? "red" : "yellow", device: r.device, rtf });
    } catch (e) {
      st.speed = "red";
      st.speedMsg = `Tes gagal: ${e.message}`;
      spSet(SP_STORE.check, { at: Date.now(), result: "red" });
    }
    draw();
  }

  function draw() {
    const pct = st.progress?.total ? Math.round((st.progress.loaded / st.progress.total) * 100) : 0;
    const mb = (b) => (b / 1048576).toFixed(0);
    const micSelect = st.devices.length > 1
      ? h("label", { class: "small sp-inline-field" }, "Mikrofon",
          h("select", { class: "input", onchange: (e) => { spSet(SP_STORE.mic, e.target.value); askMic(); } },
            st.devices.map((d, i) => h("option", { value: d.deviceId, selected: d.deviceId === (spGet(SP_STORE.mic) ?? stream?.getAudioTracks()[0]?.getSettings().deviceId) }, d.label || `Mikrofon ${i + 1}`))))
      : null;
    const modelStatus = crashed && st.model !== "green" ? "red" : st.model;
    const speedStatus = ["green", "yellow", "red"].includes(st.speed) ? st.speed : st.speed === "working" ? "loading" : null;
    const verdict = {
      green: ["ok", "check", "Lancar. Perangkat ini siap untuk ujian Speaking."],
      yellow: ["warn", "alert", "Bisa dipakai, tapi agak lambat. Transkripsi Part sebelumnya berjalan sambil ujian berlanjut, jadi biasanya hanya Part terakhir yang perlu ditunggu."],
      red: ["error", "x", "Tidak disarankan. Pakai laptop/komputer lain yang lebih kuat."],
    }[st.speed];

    setChildren(box,
      step(1, "Browser", st.browser,
        st.browser === "green"
          ? h("p", { class: "small muted" }, "Browser mendukung semua yang dibutuhkan.")
          : h("p", { class: "small" }, `Browser ini belum mendukung: ${missing.join(", ")}. Pakai Google Chrome atau Microsoft Edge versi terbaru, lewat alamat https://.`)),
      step(2, "Izin mikrofon", st.mic,
        st.mic === "green" ? h("p", { class: "small muted" }, "Mikrofon diizinkan.")
          : h("div", { class: "stack-sm" },
              st.micMsg ? note("error", "x", st.micMsg) : h("p", { class: "small muted" }, "Browser akan meminta izin memakai mikrofon. Pilih \"Izinkan\"."),
              st.mic === "red" ? h("ol", { class: "small help-steps" },
                h("li", null, "Klik ikon gembok di sebelah kiri alamat web."),
                h("li", null, "Cari \"Mikrofon\", ubah menjadi \"Izinkan\"."),
                h("li", null, "Muat ulang halaman ini (F5)."),
                h("li", null, "Masih gagal? Tutup aplikasi lain yang memakai mikrofon (Zoom, Meet, WhatsApp), lalu coba lagi.")) : null,
              h("div", null, h("button", { type: "button", class: "btn-primary", disabled: st.browser === "red", onclick: askMic }, icon("mic", 16), "Izinkan mikrofon")))),
      step(3, "Mikrofon menangkap suara", st.mic === "green" ? st.level : null,
        h("p", { class: "small muted" }, "Bicaralah beberapa kata. Bar hijau harus bergerak."),
        h("div", { class: "level-track" }, levelBar),
        micSelect,
        st.level === "red" ? note("error", "x", "Suara hampir tidak terdengar. Dekatkan mikrofon, naikkan volume input di pengaturan suara Windows, atau pilih mikrofon lain.") : null),
      step(4, "Alat transkripsi (Whisper)", modelStatus,
        h("p", { class: "small muted" }, "Mengubah suara menjadi teks langsung di perangkat ini. Diunduh sekali (70–200 MB), lalu tersimpan di browser. Tidak perlu memasang aplikasi apa pun."),
        crashed && st.model !== "green" ? note("error", "x", "Percobaan sebelumnya berhenti di tengah jalan (tab tertutup atau kehabisan memori). Tutup tab/aplikasi lain lalu coba lagi, atau pakai laptop lain.") : null,
        st.model === "loading" ? h("div", { class: "stack-sm" },
          h("div", { class: "level-track" }, h("div", { class: "level-fill", style: `width:${pct}%` })),
          h("p", { class: "small muted" }, st.progress?.total ? `Mengunduh ${mb(st.progress.loaded)} / ${mb(st.progress.total)} MB (${pct}%). ` : "Menyiapkan… ", "Jangan tutup halaman ini.")) : null,
        st.modelMsg ? h("p", { class: `small ${st.model === "red" ? "text-danger semibold" : "muted"}` }, st.modelMsg) : null,
        st.model !== "green" && st.model !== "loading"
          ? h("div", null, h("button", { type: "button", class: "btn-primary", disabled: st.browser === "red", onclick: loadModel }, crashed || st.model === "red" ? "Coba lagi" : "Siapkan alat transkripsi"))
          : null),
      step(5, "Tes kecepatan & ketepatan", speedStatus,
        h("p", { class: "small muted" }, "Klik \"Mulai tes\", bacakan kalimat ini dengan suara normal, lalu klik \"Selesai\"."),
        h("blockquote", { class: "sample" }, SAMPLE_SENTENCE),
        st.speed === "working" ? h("p", { class: "small muted" }, "Mentranskripsi…") : null,
        st.transcript ? h("p", { class: "small" }, h("span", { class: "semibold" }, "Hasil: "), st.transcript) : null,
        st.speedMsg ? h("p", { class: "small muted" }, st.speedMsg) : null,
        verdict ? note(verdict[0], verdict[1], verdict[2]) : null,
        h("div", null, h("button", { type: "button", class: st.speed === "recording" ? "btn-primary btn-danger" : "btn-primary",
          disabled: st.mic !== "green" || st.model !== "green" || st.speed === "working", onclick: speedTest },
          st.speed === "recording" ? [icon("stop", 16), "Selesai"] : [icon("mic", 16), st.speed && st.speed !== "working" ? "Ulangi tes" : "Mulai tes"]))),
    );
    nextLink.classList.toggle("hidden", !["green", "yellow"].includes(st.speed));
  }

  const nextLink = h("a", { href: "/speaking", class: "btn-primary btn-lg hidden" }, "Lanjut ke Speaking", icon("arrowRight", 18));
  setChildren(root, h("div", { class: "stack-lg sp-narrow" },
    pageHead("Cek Perangkat", "Lakukan sekali sebelum ujian pertama di perangkat ini. Cukup Chrome atau Edge versi terbaru.", { href: "/speaking", label: "Speaking" }),
    isMobileDevice()
      ? note("warn", "alert", "Perangkat ini terdeteksi sebagai HP/tablet. Boleh dicoba, tetapi untuk ujian lengkap laptop atau komputer jauh lebih stabil.")
      : note("info", "laptop", SP_DEVICE_NOTE),
    box,
    note("info", "shield", h("span", { class: "small" }, SP_PRIVACY_SHORT)),
    h("div", null, nextLink)));
  draw();
  modelCached().then((cached) => {
    if (cached && !crashed) loadModel();
  });
}

// ---------------------------------------------------------------- /speaking/{id}

function speakingTest(root, initial) {
  let view = initial;
  const st = {
    part: null,
    stream: null,
    meter: null,
    rec: null,
    jobs: {}, // part -> { status: 'queued'|'working'|'saving'|'error', message, text, seconds }
    error: null,
    interrupted: false,
    modelState: "idle",
    modelMsg: "",
    busy: false,
    misheard: {},
    form: null,
    showAi: false,
    confirmRerecord: null,
  };
  const levelBar = h("div", { class: "level-fill" });
  let tickTimer = null;

  const hasTranscript = (p) => view.transcripts?.[p]?.text !== undefined;
  const allDone = () => view.parts.every((p) => hasTranscript(p) && !st.jobs[p]);
  const pendingWork = () => !!st.rec || Object.values(st.jobs).some((j) => j.status !== "error");

  window.addEventListener("beforeunload", (e) => {
    if (pendingWork()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  Whisper.listeners.add((ev) => {
    if (ev.type === "progress" && ev.total) st.modelMsg = `Menyiapkan alat transkripsi ${Math.round((ev.loaded / ev.total) * 100)}%…`;
    if (ev.type === "ready") {
      st.modelState = "ready";
      st.modelMsg = "";
    }
    if (ev.type === "error") {
      st.modelState = "error";
      st.modelMsg = ev.message;
    }
    if (view.status === "recording") draw();
  });

  function resetReview() {
    st.misheard = Object.fromEntries(view.parts.map((p) => [p, new Set(view.transcripts?.[p]?.misheard ?? [])]));
    const b = view.bands ?? {};
    st.form = {
      lr: b.lr ?? view.ai?.lr.band ?? null,
      gra: b.gra ?? view.ai?.gra.band ?? null,
      fc: b.fc ?? null,
      pron: b.pron ?? null,
      comment: view.examiner_comment ?? "",
    };
  }

  function setView(v) {
    view = v;
    if (v.status !== "recording") resetReview();
    draw();
  }

  async function ensureMic() {
    if (st.stream && st.stream.getAudioTracks().some((t) => t.readyState === "live")) return st.stream;
    st.stream = await openMic();
    st.meter?.stop();
    st.meter = levelMeter(st.stream, levelBar);
    return st.stream;
  }

  async function startRec(part) {
    st.error = null;
    st.interrupted = false;
    st.confirmRerecord = null;
    try {
      const stream = await ensureMic();
      st.rec = { part, handle: startRecording(stream, { onInterrupted: () => {
        st.interrupted = true;
        draw();
      } }) };
      keepScreenOn(true);
      clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        const el = document.getElementById("sp-rec-time");
        if (el && st.rec) el.textContent = fmtSec((Date.now() - st.rec.handle.started) / 1000);
      }, 500);
    } catch {
      st.error = "Mikrofon tidak bisa dipakai. Buka Cek Perangkat untuk memperbaikinya.";
    }
    draw();
  }

  async function stopRec() {
    const r = st.rec;
    if (!r) return;
    st.rec = null;
    clearInterval(tickTimer);
    keepScreenOn(false);
    const { blob, seconds } = await r.handle.stop();
    st.jobs[r.part] = { status: "queued", seconds };
    // Otomatis pindah ke Part berikutnya yang belum direkam.
    const next = view.parts.find((p) => p !== r.part && !hasTranscript(p) && !st.jobs[p]);
    if (next) st.part = next;
    draw();
    processPart(r.part, blob, seconds);
  }

  async function processPart(part, blob, seconds) {
    try {
      const pcm = await blobToPcm16k(blob);
      blob = null; // audio dibuang begitu sudah diubah ke data mentah untuk Whisper
      st.jobs[part] = { status: "working", seconds };
      draw();
      const r = await Whisper.transcribe(pcm);
      st.jobs[part] = { status: "saving", seconds, text: r.text };
      draw();
      await saveTranscript(part);
    } catch (e) {
      st.jobs[part] = { ...(st.jobs[part] ?? {}), status: "error", message: e instanceof ApiError ? e.message : `Transkripsi gagal: ${e.message}` };
      draw();
    }
  }

  async function saveTranscript(part) {
    const j = st.jobs[part];
    j.status = "saving";
    draw();
    try {
      const v = await api(`/api/speaking/${view.id}/transcript`, { method: "PUT", json: { part, text: j.text, seconds: j.seconds } });
      delete st.jobs[part];
      view = v;
    } catch (e) {
      j.status = "error";
      j.message = `Transkrip belum tersimpan: ${errorMessage(e)}`;
      j.retrySave = true;
    }
    draw();
  }

  async function assess(withMarks) {
    st.busy = true;
    st.error = null;
    draw();
    try {
      const json = withMarks ? { misheard: Object.fromEntries(Object.entries(st.misheard).map(([p, s]) => [p, [...s].sort((a, b) => a - b)])) } : {};
      const v = await api(`/api/speaking/${view.id}/assess`, { method: "POST", json });
      st.busy = false;
      const keep = withMarks && st.form ? { fc: st.form.fc, pron: st.form.pron, comment: st.form.comment } : null;
      setView(v);
      if (keep) {
        Object.assign(st.form, keep, { lr: v.ai.lr.band, gra: v.ai.gra.band });
        draw();
      }
    } catch (e) {
      st.busy = false;
      st.error = errorMessage(e);
      draw();
    }
  }

  async function finalize() {
    st.busy = true;
    st.error = null;
    draw();
    try {
      const f = st.form;
      const v = await api(`/api/speaking/${view.id}/finalize`, { method: "POST", json: { bands: { fc: f.fc, lr: f.lr, gra: f.gra, pron: f.pron }, comment: f.comment } });
      st.busy = false;
      setView(v);
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      st.busy = false;
      st.error = errorMessage(e);
      draw();
    }
  }

  async function reopen() {
    st.busy = true;
    try {
      setView(await api(`/api/speaking/${view.id}/reopen`, { method: "POST", json: {} }));
    } catch (e) {
      st.error = errorMessage(e);
    }
    st.busy = false;
    draw();
  }

  const head = () => pageHead(view.student_name ?? "Ujian Speaking", `${view.set.name} · ${view.mode_label}`, { href: "/speaking", label: "Speaking" });

  // ---- status recording
  function partState(p) {
    const j = st.jobs[p];
    if (st.rec?.part === p) return { cls: "rec", text: "Merekam" };
    if (j?.status === "queued") return { cls: "busy", text: "Antre transkripsi" };
    if (j?.status === "working") return { cls: "busy", text: "Mentranskripsi…" };
    if (j?.status === "saving") return { cls: "busy", text: "Menyimpan…" };
    if (j?.status === "error") return { cls: "error", text: "Gagal" };
    if (hasTranscript(p)) return { cls: "done", text: `${wordsOf(view.transcripts[p].text).length} kata` };
    return { cls: "todo", text: "Belum direkam" };
  }

  function drawRecording() {
    const parts = view.parts;
    if (!st.part || !parts.includes(st.part)) st.part = parts.find((p) => !hasTranscript(p)) ?? parts[0];
    const p = st.part;
    const j = st.jobs[p];
    const recordingThis = st.rec?.part === p;
    const ready = allDone();
    const check = spGet(SP_STORE.check);
    const done = parts.filter((x) => hasTranscript(x) && !st.jobs[x]).length;

    const recordBtn = recordingThis
      ? h("button", { type: "button", class: "btn-primary btn-danger btn-lg btn-block", onclick: stopRec }, icon("stop", 18), `Selesai ${PART_NAMES[p]}`)
      : h("button", { type: "button", class: "btn-primary btn-lg btn-block", disabled: !!st.rec || (j && j.status !== "error"),
          onclick: () => {
            if (hasTranscript(p) && st.confirmRerecord !== p) {
              st.confirmRerecord = p;
              draw();
              return;
            }
            startRec(p);
          } }, icon(hasTranscript(p) ? "rotate" : "mic", 18), hasTranscript(p) || j ? `Rekam ulang ${PART_NAMES[p]}` : `Mulai rekam ${PART_NAMES[p]}`);

    const panel = h("aside", { class: "card sp-panel stack" },
      parts.length > 1 ? h("ol", { class: "sp-parts", "aria-label": "Daftar Part" }, parts.map((x) => {
        const s = partState(x);
        return h("li", null, h("button", { type: "button", class: `sp-part${x === p ? " active" : ""}`, disabled: !!st.rec && x !== p, "aria-current": x === p ? "step" : null,
          onclick: () => { st.part = x; st.confirmRerecord = null; draw(); } },
          h("span", { class: `sp-part-dot ${s.cls}` }, s.cls === "done" ? icon("check", 12) : null),
          h("span", { class: "grow semibold" }, PART_NAMES[x]),
          h("span", { class: `sp-part-state ${s.cls}` }, s.text)));
      })) : null,
      h("div", { class: "sp-recorder" },
        h("div", { class: "row", style: "justify-content:space-between" },
          h("span", { class: "small muted semibold" }, recordingThis ? h("span", { class: "rec-live" }, h("span", { class: "rec-dot", "aria-hidden": "true" }), "Merekam") : "Durasi rekaman"),
          h("span", { class: "small muted" }, PART_NAMES[p])),
        h("p", { class: "sp-timer", id: "sp-rec-time", "aria-live": "off" },
          recordingThis ? fmtSec((Date.now() - st.rec.handle.started) / 1000) : j?.seconds ? fmtSec(j.seconds) : hasTranscript(p) ? fmtSec(view.transcripts[p].seconds ?? 0) : "0:00"),
        h("div", { class: "level-track", title: "Volume mikrofon" }, levelBar)),
      st.interrupted ? note("error", "x", "Rekaman terputus (mikrofon dicabut atau dipakai aplikasi lain). Klik Selesai lalu rekam ulang Part ini.") : null,
      st.confirmRerecord === p ? note("warn", "alert", `Transkrip ${PART_NAMES[p]} yang lama akan diganti. Klik "Rekam ulang" sekali lagi untuk melanjutkan.`) : null,
      j?.status === "error" ? note("error", "x", j.message, j.retrySave ? h("div", { style: "margin-top:8px" }, h("button", { type: "button", class: "btn-secondary", onclick: () => saveTranscript(p) }, "Coba simpan lagi")) : null) : null,
      recordBtn,
      h("hr", { class: "sp-divider" }),
      h("div", { class: "stack-sm" },
        h("p", { class: "small muted" }, ready ? "Semua Part sudah ditranskripsi." : `${done} dari ${parts.length} Part selesai ditranskripsi.`),
        h("button", { type: "button", class: "btn-primary btn-block", disabled: !ready || st.busy || !!st.rec, onclick: () => assess(false) },
          st.busy ? [icon("loader", 16, "spin"), "AI sedang menilai…"] : ["Lanjut ke penilaian", icon("arrowRight", 16)])),
      st.error ? note("error", "x", st.error) : null,
      st.modelState === "error" ? note("error", "x", `Alat transkripsi gagal dimuat: ${st.modelMsg}`)
        : st.modelMsg ? h("p", { class: "small muted" }, st.modelMsg) : null,
      !check ? note("warn", "alert", "Perangkat ini belum dicek. ", h("a", { href: "/speaking/cek", class: "semibold link" }, "Buka Cek Perangkat")) : null,
      h("p", { class: "small muted sp-privacy" }, icon("shield", 14), SP_PRIVACY_SHORT));

    const question = h("section", { class: "card stack sp-question" },
      h("div", { class: "row", style: "justify-content:space-between" },
        h("h2", { class: "section-title", style: "margin:0" }, PART_NAMES[p]),
        h("span", { class: `sp-part-state ${partState(p).cls}` }, partState(p).text)),
      partQuestion(view.set, p),
      hasTranscript(p) && !j ? h("details", { class: "sp-transcript-preview" }, h("summary", null, "Lihat transkrip"),
        h("p", { class: "small prewrap", style: "margin-top:8px" }, view.transcripts[p].text || "(kosong)")) : null);

    setChildren(root, h("div", { class: "stack-lg" }, head(), h("div", { class: "sp-layout" }, question, panel)));
  }

  // ---- status review
  const bandSelect = (key, label) => h("label", { class: "band-field" },
    h("span", { class: "semibold small" }, label),
    h("select", { class: `input${st.form[key] === null ? " empty" : ""}`, onchange: (e) => {
      st.form[key] = e.target.value === "" ? null : Number(e.target.value);
      draw();
    } },
      h("option", { value: "", selected: st.form[key] === null }, "Pilih band"),
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((b) => h("option", { value: String(b), selected: st.form[key] === b }, String(b)))));

  function examplesList(examples) {
    if (!examples?.length) return null;
    return h("ul", { class: "sp-examples" }, examples.map((x) =>
      h("li", { class: x.kind === "good" ? "good" : "bad" },
        h("span", { class: "ex-mark" }, icon(x.kind === "good" ? "check" : "x", 14), h("span", { class: "sr-only" }, x.kind === "good" ? "Bagus: " : "Perlu diperbaiki: ")),
        h("span", null,
          h("span", { class: "italic" }, `“${x.quote}”`),
          x.kind === "error" && x.correction ? [" → ", h("span", { class: "semibold" }, x.correction)] : null,
          h("span", { class: "small muted", style: "display:block" }, x.note)))));
  }

  function transcriptMarker(p) {
    const ws = wordsOf(view.transcripts[p].text);
    const set = st.misheard[p];
    return h("div", { class: "sp-transcript" },
      ws.length ? ws.map((w, i) => [h("button", { type: "button", class: `word${set.has(i) ? " misheard" : ""}`, "aria-pressed": set.has(i) ? "true" : "false",
        onclick: () => {
          if (set.has(i)) set.delete(i);
          else set.add(i);
          draw();
        } }, w), " "]) : h("span", { class: "muted" }, "(kosong)"));
  }

  const marksChanged = () => view.parts.some((p) => {
    const a = [...st.misheard[p]].sort().join(",");
    const b = [...(view.transcripts[p].misheard ?? [])].sort().join(",");
    return a !== b;
  });

  function drawReview() {
    const f = st.form;
    const ai = view.ai;
    const missing = ["fc", "lr", "gra", "pron"].filter((k) => f[k] === null).length;
    const changedAi = ai && (f.lr !== ai.lr.band || f.gra !== ai.gra.band);
    const aiDraft = ai ? `Lexical Resource: ${ai.lr.summary}\n\nGrammatical Range & Accuracy: ${ai.gra.summary}` : "";
    const commentBox = h("textarea", { class: "input", id: "sp-comment", rows: "4", maxlength: "3000", placeholder: "Komentar personal untuk murid. Kosong = tidak ditampilkan di laporan.",
      oninput: (e) => (f.comment = e.target.value) });
    commentBox.value = f.comment;

    const aiCard = (k, name) => h("div", { class: "stack-sm sp-ai" },
      h("p", { class: "small semibold" }, `${name} · usulan AI ${ai[k].band}`),
      h("p", { class: "small" }, ai[k].summary),
      examplesList(ai[k].examples));

    const panel = h("aside", { class: "card sp-panel stack" },
      h("div", { class: "sp-overall" },
        h("span", { class: "small muted semibold" }, view.label),
        missing ? h("span", { class: "sp-overall-empty" }, `Isi ${missing} skor lagi`) : h("span", { class: "sp-overall-num" }, band1(roundHalfJs((f.fc + f.lr + f.gra + f.pron) / 4)))),
      h("div", { class: "band-grid" },
        bandSelect("fc", "Fluency & Coherence"),
        bandSelect("pron", "Pronunciation"),
        bandSelect("lr", "Lexical Resource"),
        bandSelect("gra", "Grammatical Range & Accuracy")),
      h("p", { class: "small muted" }, "Fluency & Coherence dan Pronunciation diisi examiner. Lexical Resource dan Grammar sudah terisi usulan AI dan boleh diubah."),
      h("div", { class: "stack-sm" },
        h("label", { class: "label", for: "sp-comment" }, "Examiner's comment (opsional)"),
        commentBox,
        changedAi && aiDraft ? h("button", { type: "button", class: "link-btn", onclick: () => {
          f.comment = f.comment.trim() ? `${f.comment.trim()}\n\n${aiDraft}` : aiDraft;
          draw();
        } }, "Pakai catatan AI sebagai draf") : null),
      st.error ? note("error", "x", st.error) : null,
      h("button", { type: "button", class: "btn-primary btn-lg btn-block", disabled: missing > 0 || st.busy, onclick: finalize }, st.busy ? "Menyimpan…" : "Finalize"));

    const main = h("div", { class: "stack" },
      ai ? h("section", { class: "card stack-sm" },
        h("details", { open: st.showAi, ontoggle: (e) => (st.showAi = e.target.open) },
          h("summary", { class: "semibold" }, "Alasan & contoh dari AI"),
          h("div", { class: "grid-2", style: "margin-top:12px" }, aiCard("lr", "Lexical Resource"), aiCard("gra", "Grammar")))) : null,
      h("section", { class: "card stack" },
        h("div", { class: "stack-sm" },
          h("h2", { class: "section-title", style: "margin:0" }, "Transkrip"),
          h("p", { class: "small muted" }, "Klik kata yang salah dengar oleh mesin transkripsi (misalnya nama tempat yang berubah jadi kata lain). Kata yang ditandai diabaikan AI. Teks tidak bisa diedit.")),
        view.parts.map((p) => h("div", { class: "stack-sm" },
          h("h3", { class: "bold" }, PART_NAMES[p], h("span", { class: "small muted" }, ` · ${fmtSec(view.transcripts[p].seconds ?? 0)}`)),
          transcriptMarker(p))),
        marksChanged() ? h("div", null, h("button", { type: "button", class: "btn-secondary", disabled: st.busy, onclick: () => assess(true) },
          st.busy ? [icon("loader", 16, "spin"), "AI sedang menilai ulang…"] : "Nilai ulang LR & Grammar dengan tanda ini")) : null));

    setChildren(root, h("div", { class: "stack-lg" }, head(), h("div", { class: "sp-layout review" }, main, panel)));
  }

  // ---- status final
  function descriptorBlock(c) {
    const d = c.descriptor;
    return h("div", { class: "stack-sm" },
      h("ul", { class: "descriptor" }, d.lines.map((l) => h("li", null, l))),
      d.see.length ? h("details", null, h("summary", { class: "small" }, `Lihat descriptor band ${d.see.map((s) => s.band).join(" dan ")}`),
        h("div", { class: "stack-sm", style: "margin-top:8px" }, d.see.map((s) =>
          h("div", null, h("p", { class: "small semibold" }, `Band ${s.band}`), h("ul", { class: "descriptor" }, s.lines.map((l) => h("li", null, l))))))) : null);
  }

  function drawFinal() {
    const crit = view.criteria;
    const copyStatus = h("span", { class: "small", role: "status" });
    setChildren(root, h("div", { class: "stack-lg sp-report" },
      head(),
      h("section", { class: "card score-hero" },
        h("div", { class: "score-overall" },
          h("p", { class: "small muted semibold" }, view.label),
          h("p", { class: "score-big" }, band1(view.overall)),
          h("p", { class: "small muted" }, `Difinalisasi ${view.finalized_at_text}`)),
        h("ul", { class: "score-bars", "aria-label": "Skor per kriteria" }, crit.map((c) =>
          h("li", null,
            h("div", { class: "bar-label" }, h("span", { class: "small semibold" }, c.name), h("span", { class: "bold" }, String(c.band))),
            h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: `width:${(c.band / 9) * 100}%` }))))),
        h("div", { class: "row-sm score-actions" },
          h("button", { type: "button", class: "btn-primary", onclick: async () => {
            const { html, text } = speakingReport(view);
            const ok = await copyRich(html, text);
            copyStatus.className = ok ? "small notice" : "small text-danger";
            copyStatus.textContent = ok ? "Tersalin. Tempel (Ctrl+V) di Google Docs." : "Browser menolak menyalin.";
          } }, icon("clipboard", 16), "Salin untuk murid"),
          h("button", { type: "button", class: "btn-secondary", disabled: st.busy, onclick: reopen }, "Buka kembali"),
          copyStatus)),
      view.examiner_comment ? h("section", { class: "card stack-sm" }, h("h2", { class: "section-title", style: "margin:0" }, "Examiner's comment"), h("p", { class: "prewrap" }, view.examiner_comment)) : null,
      st.error ? note("error", "x", st.error) : null,
      h("div", { class: "stack" }, crit.map((c) =>
        h("section", { class: "criterion" },
          h("div", { class: "criterion-head" }, h("h3", null, c.name), h("span", { class: "band" }, String(c.band))),
          h("p", { class: "small muted", style: "margin:2px 0 8px" }, c.by === "ai" ? "Usulan AI, disetujui examiner" : "Dinilai examiner"),
          c.summary ? h("p", { class: "feedback" }, c.summary) : null,
          c.examples.length ? h("div", { class: "stack-sm", style: "margin-top:12px" }, h("p", { class: "small semibold" }, "Contoh dari jawaban"), examplesList(c.examples)) : null,
          h("details", { open: !c.examples.length, style: "margin-top:12px" }, h("summary", { class: "small" }, `Descriptor resmi band ${c.band}`), h("div", { style: "margin-top:8px" }, descriptorBlock(c)))))),
      h("details", { class: "card" }, h("summary", { class: "semibold" }, "Transkrip"),
        h("div", { class: "stack", style: "margin-top:12px" }, view.parts.map((p) =>
          h("div", { class: "stack-sm" }, h("h3", { class: "bold" }, PART_NAMES[p]), h("p", { class: "prewrap small" }, view.transcripts[p]?.text || "(kosong)"))))),
      h("p", { class: "small muted" }, "Transkrip dibuat otomatis oleh mesin dan bisa berbeda sedikit dari ucapan asli. Skor ini adalah hasil latihan, bukan skor resmi IELTS.")));
  }

  function draw() {
    if (view.status === "recording") drawRecording();
    else if (view.status === "review") drawReview();
    else drawFinal();
  }

  if (view.status !== "recording") resetReview();
  draw();
  if (view.status === "recording" && !allDone()) {
    st.modelMsg = "Menyiapkan alat transkripsi…";
    Whisper.load().catch(() => {});
    ensureMic().then(() => draw()).catch(() => {});
  }
}

/** Sama dengan round_half di PHP. */
function roundHalfJs(x) {
  const r = Math.round(x * 10000) / 10000;
  const whole = Math.floor(r);
  const frac = r - whole;
  return frac < 0.25 ? whole : frac < 0.75 ? whole + 0.5 : whole + 1;
}

/** Laporan untuk murid: HTML (Google Docs) + teks biasa. */
function speakingReport(v) {
  const H = [];
  const T = [];
  H.push(`<h2>IELTS Speaking — ${escHtml(v.student_name ?? "")}</h2>`);
  H.push(`<p>${escHtml(v.set.name)} · ${escHtml(v.mode_label)} · ${escHtml(v.finalized_at_text)}</p>`);
  T.push(`IELTS Speaking — ${v.student_name ?? ""}`, `${v.set.name} · ${v.mode_label} · ${v.finalized_at_text}`);
  H.push(`<p><b>${escHtml(v.label)}: ${band1(v.overall)}</b></p>`);
  T.push(`${v.label}: ${band1(v.overall)}`);
  H.push("<ul>" + v.criteria.map((c) => `<li>${escHtml(c.name)}: <b>${c.band}</b></li>`).join("") + "</ul>");
  T.push(v.criteria.map((c) => `- ${c.name}: ${c.band}`).join("\n"));
  if (v.examiner_comment) {
    H.push(`<h3>Examiner's comment</h3>${htmlParas(escHtml(v.examiner_comment))}`);
    T.push(`Examiner's comment\n${v.examiner_comment}`);
  }
  for (const c of v.criteria) {
    H.push(`<h3>${escHtml(c.name)} — ${c.band}</h3>`);
    const t = [`${c.name} — ${c.band}`];
    if (c.summary) {
      H.push(`<p>${escHtml(c.summary)}</p>`);
      t.push(c.summary);
    }
    if (c.examples.length) {
      H.push("<ul>" + c.examples.map((x) => `<li>${x.kind === "good" ? "✓" : "✗"} <i>“${escHtml(x.quote)}”</i>${x.kind === "error" && x.correction ? ` → <b>${escHtml(x.correction)}</b>` : ""} — ${escHtml(x.note)}</li>`).join("") + "</ul>");
      t.push(c.examples.map((x) => `${x.kind === "good" ? "✓" : "✗"} "${x.quote}"${x.kind === "error" && x.correction ? ` → ${x.correction}` : ""} — ${x.note}`).join("\n"));
    }
    H.push(`<p style="color:#6b7280"><i>Band descriptor ${c.band}:</i></p><ul>` + c.descriptor.lines.map((l) => `<li style="color:#6b7280">${escHtml(l)}</li>`).join("") + "</ul>");
    t.push(`Band descriptor ${c.band}:\n` + c.descriptor.lines.map((l) => `- ${l}`).join("\n"));
    T.push(t.join("\n"));
  }
  const noteText = "Skor ini adalah hasil latihan Speaking, bukan skor resmi IELTS. Transkrip dibuat otomatis oleh mesin.";
  H.push(`<p style="color:#6b7280"><i>${noteText}</i></p>`);
  T.push(noteText);
  return { html: H.join(""), text: T.join("\n\n") };
}

// ---------------------------------------------------------------- mulai halaman

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  const dataEl = document.getElementById("page-data");
  if (!root || !dataEl) return;
  const page = root.dataset.page;
  if (!page.startsWith("speaking")) return;
  const data = JSON.parse(dataEl.textContent);
  if (page === "speaking") speakingHome(root, data);
  else if (page === "speaking-check") speakingCheck(root);
  else if (page === "speaking-test") speakingTest(root, data.view);
});
