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

const SP_DISCLAIMER = "Gunakan komputer atau laptop yang memadai dengan mikrofon untuk pengalaman terbaik. Perangkat lain boleh dicoba, tetapi hasilnya bisa lambat atau tidak stabil.";
const SP_PRIVACY = "Audio tidak disimpan dan tidak dikirim ke mana pun. Rekaman diubah jadi teks di perangkat ini lalu langsung dibuang. Hanya transkrip teks dan nilai yang disimpan.";
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
    this.worker = new Worker("/assets/whisper-worker.js", { type: "module" });
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
  loadOnce(prefer) {
    this.start();
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.worker.postMessage({ type: "load", prefer });
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
      const prefer = await this.prefer();
      try {
        return await this.loadOnce(prefer);
      } catch (e) {
        if (prefer !== "webgpu") throw e;
        this.stop();
        this.emit({ type: "log", message: "Kartu grafis tidak bisa dipakai, pindah ke prosesor (lebih lambat)…" });
        return await this.loadOnce("wasm");
      }
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
    const run = async () => {
      const device = await this.load();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        this.worker.postMessage({ type: "transcribe", id, audio, prefer: device }, [audio.buffer]);
      });
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

function spBanner(kind, ...children) {
  return h("div", { class: kind === "error" ? "banner-error" : kind === "ok" ? "sp-banner-ok" : "banner-warning" }, ...children);
}

function checkSummaryText(c) {
  if (!c) return ["warn", "Perangkat ini belum dicek."];
  if (c.result === "green") return ["ok", `Perangkat siap (dicek ${formatDateId(new Date(c.at).toISOString())}).`];
  if (c.result === "yellow") return ["warn", "Perangkat bisa dipakai, tapi transkripsi lambat."];
  return ["error", "Perangkat ini tidak disarankan untuk ujian Speaking."];
}

function fmtSec(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function wordsOf(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Soal satu Part. */
function partQuestion(set, part) {
  if (part === "p2") {
    const c = set.part2;
    return h("div", { class: "cue-card" },
      h("p", { class: "bold" }, c.title),
      h("p", { class: "semibold", style: "margin-top:10px" }, "You should say:"),
      h("ul", { class: "cue-points" }, c.points.map((p) => h("li", null, p))),
      h("p", { class: "bold", style: "margin-top:6px" }, c.final),
      h("p", { class: "small muted", style: "margin-top:12px" }, "Murid punya 1 menit untuk bersiap (boleh membuat catatan), lalu berbicara 1–2 menit."));
  }
  const topics = set[part === "p1" ? "part1" : "part3"];
  return h("div", { class: "stack" }, topics.map((t) =>
    h("div", { class: "sp-topic" },
      h("p", { class: "bold" }, t.topic),
      t.intro ? h("p", { class: "italic muted small" }, t.intro) : null,
      h("ul", { class: "sp-questions" }, t.questions.map((q) => h("li", null, q))))));
}

// ---------------------------------------------------------------- /speaking

function speakingHome(root, data) {
  const [kind, text] = checkSummaryText(spGet(SP_STORE.check));
  const err = h("div");
  const studentInput = h("input", { class: "input", id: "sp-student", list: "sp-students", maxlength: "100", placeholder: "Nama murid", autocomplete: "off" });
  const setSelect = h("select", { class: "input", id: "sp-set" }, data.sets.map((s) => h("option", { value: s.id }, `${s.name} — ${s.part2}`)));
  const modeSelect = h("select", { class: "input", id: "sp-mode" }, Object.entries(data.modes).map(([k, v]) => h("option", { value: k, selected: k === "full" }, v)));
  const startBtn = h("button", { type: "submit", class: "btn-primary btn-lg" }, "Mulai ujian");

  const form = h("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    setChildren(err);
    startBtn.disabled = true;
    try {
      const r = await api("/api/speaking", { method: "POST", json: { student_name: studentInput.value, set_id: setSelect.value, mode: modeSelect.value } });
      location.href = `/speaking/${r.id}`;
    } catch (ex) {
      setChildren(err, errorBanner(errorMessage(ex)));
      startBtn.disabled = false;
    }
  } },
    h("h2", { class: "section-title", style: "margin:0" }, "Mulai ujian baru"),
    h("div", null, h("label", { class: "label", for: "sp-student" }, "Nama murid"), studentInput,
      h("datalist", { id: "sp-students" }, data.students.map((n) => h("option", { value: n })))),
    h("div", null, h("label", { class: "label", for: "sp-set" }, "Set soal"), setSelect),
    h("div", null, h("label", { class: "label", for: "sp-mode" }, "Mode"), modeSelect,
      h("p", { class: "small muted", style: "margin-top:4px" }, "Mode satu Part menghasilkan \"estimasi latihan\"; mode lengkap menghasilkan \"skor simulasi\".")),
    h("p", { class: "small muted" }, SP_PRIVACY),
    err,
    h("div", null, startBtn));

  const list = data.tests.length
    ? h("ul", { class: "stack-sm" }, data.tests.map((t) =>
        h("li", null, h("a", { href: `/speaking/${t.id}`, class: "card list-item" },
          h("span", { class: "grow" },
            h("span", { class: "semibold", style: "display:block" }, t.student_name ?? "Tanpa nama"),
            h("span", { class: "small muted" }, `${t.set_name} · ${t.mode_label} · ${t.created_at_text}`)),
          h("span", { class: "score" }, t.status === "final" ? band1(t.overall) : t.status === "review" ? "Dinilai" : "Belum selesai")))))
    : h("p", { class: "muted" }, "Belum ada ujian Speaking.");

  setChildren(root, h("div", { class: "stack-lg" },
    h("h1", { class: "page-title" }, "Speaking"),
    spBanner("warn", SP_DISCLAIMER),
    h("div", { class: "card row", style: "justify-content:space-between" },
      h("p", { class: kind === "ok" ? "notice" : kind === "error" ? "text-danger semibold" : "semibold" }, text),
      h("a", { href: "/speaking/cek", class: "btn-secondary" }, kind === "ok" ? "Cek ulang perangkat" : "Cek perangkat")),
    form,
    h("section", null, h("h2", { class: "section-title" }, "Ujian sebelumnya"), list)));
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
  const box = h("div", { class: "stack" });

  const icon = (s) => h("span", { class: `check-icon ${s ?? "todo"}`, "aria-hidden": "true" }, s === "green" ? "✓" : s === "yellow" ? "!" : s === "red" ? "✕" : "");
  const item = (n, title, status, ...body) => h("section", { class: `card check-item ${status ?? ""}` },
    h("div", { class: "row", style: "flex-wrap:nowrap;align-items:flex-start" }, icon(status),
      h("div", { class: "grow stack-sm" }, h("h2", { class: "bold" }, `${n}. ${title}`), ...body)));

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
      st.level = "yellow";
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
      st.modelMsg = dev === "webgpu" ? "Siap. Memakai kartu grafis (cepat)." : "Siap. Memakai prosesor (kartu grafis tidak tersedia, jadi lebih lambat).";
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
      const wait = Math.round(rtf * 240);
      st.speedMsg = `${fmtSec(seconds)} rekaman ditranskripsi dalam ${(r.ms / 1000).toFixed(1)} detik. Perkiraan tunggu untuk jawaban 4 menit: ±${wait < 60 ? `${wait} detik` : `${Math.round(wait / 60)} menit`}. Kecocokan dengan kalimat contoh: ${Math.round(acc * 100)}%.`;
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
      ? h("label", { class: "small" }, "Mikrofon: ",
          h("select", { class: "input", style: "max-width:360px;display:inline-block", onchange: (e) => { spSet(SP_STORE.mic, e.target.value); askMic(); } },
            st.devices.map((d, i) => h("option", { value: d.deviceId, selected: d.deviceId === (spGet(SP_STORE.mic) ?? stream?.getAudioTracks()[0]?.getSettings().deviceId) }, d.label || `Mikrofon ${i + 1}`))))
      : null;
    const modelStatus = crashed && st.model !== "green" ? "red" : st.model === "loading" ? "yellow" : st.model;

    setChildren(box,
      item(1, "Browser", st.browser,
        st.browser === "green"
          ? h("p", { class: "small" }, "Browser mendukung semua yang dibutuhkan.")
          : h("p", { class: "small" }, `Browser ini belum mendukung: ${missing.join(", ")}. Pakai Google Chrome atau Microsoft Edge versi terbaru, dan buka situs lewat alamat https://.`)),
      item(2, "Izin mikrofon", st.mic,
        st.mic === "green" ? h("p", { class: "small" }, "Mikrofon diizinkan.")
          : h("div", { class: "stack-sm" },
              st.micMsg ? h("p", { class: "small text-danger semibold" }, st.micMsg) : h("p", { class: "small" }, "Browser akan meminta izin memakai mikrofon. Pilih \"Izinkan\"."),
              st.mic === "red" ? h("ol", { class: "small help-steps" },
                h("li", null, "Klik ikon gembok (🔒) di sebelah kiri alamat web."),
                h("li", null, "Cari \"Mikrofon\", ubah menjadi \"Izinkan\"."),
                h("li", null, "Muat ulang halaman ini (tekan F5)."),
                h("li", null, "Kalau masih gagal: tutup aplikasi lain yang memakai mikrofon (Zoom, Meet, WhatsApp), lalu coba lagi.")) : null,
              h("button", { type: "button", class: "btn-primary", disabled: st.browser === "red", onclick: askMic }, "Izinkan mikrofon"))),
      item(3, "Mikrofon menangkap suara", st.mic === "green" ? st.level : null,
        h("p", { class: "small" }, "Bicaralah beberapa kata. Bar hijau harus bergerak."),
        h("div", { class: "level-track" }, levelBar),
        micSelect,
        st.level === "red" ? h("p", { class: "small text-danger semibold" }, "Suara hampir tidak terdengar. Dekatkan mikrofon, naikkan volume input di pengaturan suara Windows, atau pilih mikrofon lain.") : null),
      item(4, "Alat transkripsi (Whisper)", modelStatus,
        h("p", { class: "small" }, "Alat ini mengubah suara menjadi teks langsung di perangkat ini. Diunduh sekali (sekitar 70–200 MB), setelah itu tersimpan di browser. Tidak perlu memasang aplikasi apa pun."),
        crashed && st.model !== "green" ? h("p", { class: "small text-danger semibold" }, "Percobaan sebelumnya berhenti di tengah jalan (tab tertutup atau kehabisan memori). Perangkat ini kemungkinan tidak kuat. Tutup tab/aplikasi lain lalu coba lagi, atau pakai laptop lain.") : null,
        st.model === "loading" ? h("div", { class: "stack-sm" },
          h("div", { class: "level-track" }, h("div", { class: "level-fill", style: `width:${pct}%` })),
          h("p", { class: "small muted" }, st.progress?.total ? `Mengunduh ${mb(st.progress.loaded)} / ${mb(st.progress.total)} MB (${pct}%)…` : "Menyiapkan…", " Jangan tutup halaman ini.")) : null,
        st.modelMsg ? h("p", { class: `small ${st.model === "red" ? "text-danger semibold" : "muted"}` }, st.modelMsg) : null,
        st.model !== "green" && st.model !== "loading"
          ? h("button", { type: "button", class: "btn-primary", disabled: st.browser === "red", onclick: loadModel }, crashed || st.model === "red" ? "Coba lagi" : "Siapkan alat transkripsi")
          : null),
      item(5, "Tes kecepatan & ketepatan", ["green", "yellow", "red"].includes(st.speed) ? st.speed : null,
        h("p", { class: "small" }, "Klik \"Mulai tes\", bacakan kalimat di bawah dengan suara normal, lalu klik \"Selesai\"."),
        h("blockquote", { class: "sample" }, SAMPLE_SENTENCE),
        st.speed === "working" ? h("p", { class: "small muted spinner-text" }, "Mentranskripsi") : null,
        st.transcript ? h("p", { class: "small" }, h("span", { class: "semibold" }, "Hasil: "), st.transcript) : null,
        st.speedMsg ? h("p", { class: "small" }, st.speedMsg) : null,
        st.speed === "green" ? h("p", { class: "notice small" }, "🟢 Lancar. Perangkat ini siap untuk ujian Speaking.") : null,
        st.speed === "yellow" ? h("p", { class: "small semibold" }, "🟡 Bisa dipakai, tapi lambat. Setelah ujian mungkin perlu menunggu beberapa menit.") : null,
        st.speed === "red" ? h("p", { class: "small text-danger semibold" }, "🔴 Tidak disarankan. Pakai laptop/komputer lain yang lebih kuat.") : null,
        h("button", { type: "button", class: st.speed === "recording" ? "btn-primary btn-danger" : "btn-primary",
          disabled: st.mic !== "green" || st.model !== "green" || st.speed === "working", onclick: speedTest },
          st.speed === "recording" ? "Selesai" : st.speed && st.speed !== "working" ? "Ulangi tes" : "Mulai tes")),
      st.speed && ["green", "yellow"].includes(st.speed) ? h("a", { href: "/speaking", class: "btn-primary btn-lg" }, "Lanjut ke Speaking") : null,
    );
  }

  setChildren(root, h("div", { class: "stack-lg" },
    h("div", { class: "stack-sm" },
      h("h1", { class: "page-title" }, "Cek Perangkat"),
      h("p", { class: "muted" }, "Lakukan sekali sebelum ujian Speaking pertama di perangkat ini. Tidak ada yang perlu dipasang; cukup Chrome atau Edge versi terbaru.")),
    spBanner("warn", SP_DISCLAIMER),
    isMobileDevice() ? spBanner("warn", "Perangkat ini terdeteksi sebagai HP/tablet. Boleh dicoba, tetapi untuk ujian lengkap (Part 1–3) laptop atau komputer jauh lebih stabil.") : null,
    h("p", { class: "small muted" }, SP_PRIVACY),
    box));
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

  const head = () => h("div", { class: "stack-sm" },
    h("p", { class: "small muted semibold" }, h("a", { href: "/speaking" }, "← Speaking")),
    h("h1", { class: "page-title" }, view.student_name ?? "Ujian Speaking"),
    h("p", { class: "muted" }, `${view.set.name} · ${view.mode_label}`));

  // ---- status recording
  function partStatus(p) {
    const j = st.jobs[p];
    if (st.rec?.part === p) return h("span", { class: "chip rec" }, "● Merekam");
    if (j?.status === "queued") return h("span", { class: "chip" }, "Menunggu transkripsi");
    if (j?.status === "working") return h("span", { class: "chip spinner-text" }, "Mentranskripsi");
    if (j?.status === "saving") return h("span", { class: "chip" }, "Menyimpan");
    if (j?.status === "error") return h("span", { class: "chip chip-error" }, "Gagal");
    if (hasTranscript(p)) return h("span", { class: "chip chip-ok" }, `✓ ${wordsOf(view.transcripts[p].text).length} kata`);
    return h("span", { class: "chip" }, "Belum direkam");
  }

  function drawRecording() {
    const parts = view.parts;
    if (!st.part || !parts.includes(st.part)) st.part = parts.find((p) => !hasTranscript(p)) ?? parts[0];
    const p = st.part;
    const j = st.jobs[p];
    const recordingThis = st.rec?.part === p;
    const otherRecording = st.rec && !recordingThis;
    const idx = parts.indexOf(p);
    const next = parts[idx + 1];
    const check = spGet(SP_STORE.check);

    const controls = h("div", { class: "card stack-sm rec-box" },
      h("div", { class: "row", style: "justify-content:space-between" },
        h("div", { class: "row-sm" },
          recordingThis ? h("span", { class: "rec-dot", "aria-hidden": "true" }) : null,
          h("span", { class: "bold", id: "sp-rec-time" }, recordingThis ? fmtSec((Date.now() - st.rec.handle.started) / 1000) : j?.seconds ? fmtSec(j.seconds) : hasTranscript(p) ? fmtSec(view.transcripts[p].seconds ?? 0) : "0:00"),
          h("span", { class: "small muted" }, "durasi rekaman")),
        partStatus(p)),
      h("div", { class: "level-track" }, levelBar),
      st.interrupted ? h("p", { class: "banner-error small" }, "Rekaman terputus (mikrofon dicabut atau dipakai aplikasi lain). Klik \"Selesai\" lalu rekam ulang Part ini.") : null,
      j?.status === "error" ? h("div", { class: "stack-sm" }, h("p", { class: "small text-danger semibold" }, j.message),
        j.retrySave ? h("button", { type: "button", class: "btn-secondary", onclick: () => saveTranscript(p) }, "Coba simpan lagi") : null) : null,
      h("div", { class: "row-sm" },
        recordingThis
          ? h("button", { type: "button", class: "btn-primary btn-danger btn-lg", onclick: stopRec }, "■ Selesai")
          : h("button", { type: "button", class: "btn-primary btn-lg", disabled: !!otherRecording || (j && j.status !== "error"),
              onclick: () => {
                if (hasTranscript(p) && !confirmReRecord()) return;
                startRec(p);
              } }, hasTranscript(p) || j ? "● Rekam ulang" : "● Mulai rekam"),
        next && !recordingThis ? h("button", { type: "button", class: "btn-secondary btn-lg", onclick: () => { st.part = next; draw(); } }, `${PART_NAMES[next]} →`) : null),
      hasTranscript(p) && !j ? h("details", null, h("summary", null, "Lihat transkrip"), h("p", { class: "small prewrap", style: "margin-top:8px" }, view.transcripts[p].text || "(kosong)")) : null);

    const ready = allDone();
    setChildren(root, h("div", { class: "stack-lg" },
      head(),
      !check ? spBanner("warn", "Perangkat ini belum dicek. ", h("a", { href: "/speaking/cek", class: "semibold", style: "text-decoration:underline" }, "Buka Cek Perangkat"), " sebelum mulai supaya tidak ada masalah di tengah ujian.") : null,
      st.modelState === "error" ? spBanner("error", `Alat transkripsi gagal dimuat: ${st.modelMsg}`) : st.modelMsg ? h("p", { class: "small muted" }, st.modelMsg) : null,
      h("p", { class: "small muted" }, SP_PRIVACY, " Jangan tutup halaman ini sampai semua Part selesai ditranskripsi."),
      parts.length > 1 ? h("div", { class: "row-sm sp-tabs", role: "tablist" }, parts.map((x) =>
        h("button", { type: "button", role: "tab", class: `sp-tab${x === p ? " active" : ""}`, "aria-selected": x === p ? "true" : "false", disabled: !!st.rec && x !== p,
          onclick: () => { st.part = x; draw(); } }, PART_NAMES[x], " ", partStatus(x)))) : null,
      h("section", { class: "card stack" }, h("h2", { class: "section-title", style: "margin:0" }, PART_NAMES[p]), partQuestion(view.set, p)),
      controls,
      st.error ? errorBanner(st.error) : null,
      h("div", { class: "card stack-sm" },
        h("p", { class: "semibold" }, ready ? "Semua Part sudah ditranskripsi." : "Tombol penilaian aktif setelah semua Part direkam dan ditranskripsi."),
        h("button", { type: "button", class: "btn-primary btn-lg", disabled: !ready || st.busy || !!st.rec, onclick: () => assess(false) },
          st.busy ? "AI sedang menilai Lexical Resource & Grammar…" : "Lanjut ke penilaian"))));
  }

  function confirmReRecord() {
    // Tidak memakai confirm() bawaan browser: tombol kedua kali = konfirmasi.
    const key = `rr-${st.part}`;
    if (st[key]) {
      st[key] = false;
      return true;
    }
    st[key] = true;
    st.error = `Transkrip ${PART_NAMES[st.part]} yang lama akan diganti. Klik "Rekam ulang" sekali lagi untuk melanjutkan.`;
    draw();
    return false;
  }

  // ---- status review
  const bandSelect = (key, label, required) => h("label", { class: "band-field" },
    h("span", { class: "semibold" }, label),
    h("select", { class: "input", onchange: (e) => {
      st.form[key] = e.target.value === "" ? null : Number(e.target.value);
      draw();
    } },
      h("option", { value: "", selected: st.form[key] === null }, required ? "Pilih…" : "–"),
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((b) => h("option", { value: String(b), selected: st.form[key] === b }, String(b)))));

  function examplesList(examples) {
    if (!examples?.length) return null;
    return h("ul", { class: "sp-examples" }, examples.map((x) =>
      h("li", { class: x.kind === "good" ? "good" : "bad" },
        h("span", { class: "ex-mark", "aria-hidden": "true" }, x.kind === "good" ? "✓" : "✗"),
        h("span", null,
          h("span", { class: "italic" }, `“${x.quote}”`),
          x.kind === "error" && x.correction ? [" → ", h("span", { class: "semibold" }, x.correction)] : null,
          h("span", { class: "small muted", style: "display:block" }, x.note)))));
  }

  function transcriptMarker(p) {
    const ws = wordsOf(view.transcripts[p].text);
    const set = st.misheard[p];
    return h("div", { class: "sp-transcript" },
      ws.length ? ws.map((w, i) => [h("button", { type: "button", class: `word${set.has(i) ? " misheard" : ""}`, title: "Klik untuk menandai salah dengar",
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
    const complete = ["fc", "lr", "gra", "pron"].every((k) => f[k] !== null);
    const overall = complete ? band1(roundHalfJs((f.fc + f.lr + f.gra + f.pron) / 4)) : "–";
    const changedAi = ai && (f.lr !== ai.lr.band || f.gra !== ai.gra.band);
    const aiDraft = ai ? `Lexical Resource: ${ai.lr.summary}\n\nGrammatical Range & Accuracy: ${ai.gra.summary}` : "";
    const commentBox = h("textarea", { class: "input", rows: "4", maxlength: "3000", placeholder: "Komentar personal untuk murid (opsional). Kosong = tidak ditampilkan di laporan.",
      oninput: (e) => (f.comment = e.target.value) });
    commentBox.value = f.comment;

    const aiCard = (k, name) => h("div", { class: "stack-sm sp-ai" },
      h("p", { class: "small muted semibold" }, `Usulan AI untuk ${name}: ${ai[k].band}`),
      h("p", { class: "small" }, ai[k].summary),
      examplesList(ai[k].examples));

    setChildren(root, h("div", { class: "stack-lg" },
      head(),
      h("section", { class: "card stack" },
        h("h2", { class: "section-title", style: "margin:0" }, "Penilaian examiner"),
        h("p", { class: "small muted" }, "Fluency & Coherence dan Pronunciation wajib diisi examiner. Lexical Resource dan Grammar sudah terisi usulan AI dan boleh diubah. Nilai yang difinalisasi adalah nilai final."),
        h("div", { class: "band-grid" },
          bandSelect("fc", "Fluency & Coherence", true),
          bandSelect("lr", "Lexical Resource", true),
          bandSelect("gra", "Grammatical Range & Accuracy", true),
          bandSelect("pron", "Pronunciation", true)),
        h("p", null, h("span", { class: "semibold" }, "Skor keseluruhan: "), h("span", { class: "score-inline" }, overall), h("span", { class: "small muted" }, ` · ${view.label}`)),
        ai ? h("details", { open: st.showAi, ontoggle: (e) => (st.showAi = e.target.open) }, h("summary", null, "Lihat alasan & contoh dari AI"),
          h("div", { class: "grid-2", style: "margin-top:12px" }, aiCard("lr", "Lexical Resource"), aiCard("gra", "Grammar"))) : null,
        h("div", { class: "stack-sm" },
          h("label", { class: "label" }, "Examiner's comment (opsional)"),
          commentBox,
          changedAi && aiDraft ? h("button", { type: "button", class: "link-btn", onclick: () => {
            f.comment = f.comment.trim() ? `${f.comment.trim()}\n\n${aiDraft}` : aiDraft;
            draw();
          } }, "Pakai catatan AI sebagai draf") : null),
        st.error ? errorBanner(st.error) : null,
        h("div", { class: "row-sm" },
          h("button", { type: "button", class: "btn-primary btn-lg", disabled: !complete || st.busy, onclick: finalize }, st.busy ? "Menyimpan…" : "Finalize"),
          !complete ? h("span", { class: "small muted" }, "Isi keempat skor dulu.") : null)),
      h("section", { class: "card stack" },
        h("h2", { class: "section-title", style: "margin:0" }, "Transkrip"),
        h("p", { class: "small muted" }, "Klik kata yang salah dengar oleh mesin transkripsi (misalnya nama tempat yang berubah jadi kata lain). Kata yang ditandai diabaikan AI. Teks tidak bisa diedit."),
        view.parts.map((p) => h("div", { class: "stack-sm" },
          h("h3", { class: "bold" }, PART_NAMES[p], h("span", { class: "small muted" }, ` · ${fmtSec(view.transcripts[p].seconds ?? 0)}`)),
          transcriptMarker(p))),
        marksChanged() ? h("button", { type: "button", class: "btn-secondary", disabled: st.busy, onclick: () => assess(true) },
          st.busy ? "AI sedang menilai ulang…" : "Nilai ulang LR/GRA dengan tanda ini") : null)));
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
    setChildren(root, h("div", { class: "stack-lg" },
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
          } }, "Salin untuk murid"),
          h("button", { type: "button", class: "btn-secondary", disabled: st.busy, onclick: reopen }, "Buka kembali"),
          copyStatus)),
      view.examiner_comment ? h("section", { class: "card stack-sm" }, h("h2", { class: "section-title", style: "margin:0" }, "Examiner's comment"), h("p", { class: "prewrap" }, view.examiner_comment)) : null,
      st.error ? errorBanner(st.error) : null,
      h("div", { class: "stack" }, crit.map((c) =>
        h("section", { class: "criterion" },
          h("div", { class: "criterion-head" }, h("h3", null, c.name), h("span", { class: "band" }, String(c.band))),
          h("p", { class: "small muted", style: "margin:4px 0 8px" }, c.by === "ai" ? "Usulan AI, disetujui examiner" : "Dinilai examiner"),
          c.summary ? h("p", { class: "feedback" }, c.summary) : null,
          c.examples.length ? h("div", { class: "stack-sm", style: "margin-top:8px" }, h("p", { class: "small semibold" }, "Contoh dari jawaban kamu"), examplesList(c.examples)) : null,
          h("details", { open: !c.examples.length, style: "margin-top:8px" }, h("summary", { class: "small" }, `Descriptor resmi band ${c.band}`), h("div", { style: "margin-top:8px" }, descriptorBlock(c)))))),
      h("details", { class: "card" }, h("summary", null, "Transkrip"),
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
  const note = "Skor ini adalah hasil latihan Speaking, bukan skor resmi IELTS. Transkrip dibuat otomatis oleh mesin.";
  H.push(`<p style="color:#6b7280"><i>${note}</i></p>`);
  T.push(note);
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
