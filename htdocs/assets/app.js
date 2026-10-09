/* IELTS Writing Rater — JavaScript halaman (tanpa build, tanpa library). */
"use strict";

// ---------------------------------------------------------------- utilitas

const CSRF = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const COPY_MIN_RUN = 5;

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** fetch JSON: { data } -> data, { error } -> ApiError. PUT/PATCH/DELETE dikirim sebagai POST + override. */
async function api(url, { method = "GET", json, body } = {}) {
  const headers = { "X-CSRF-Token": CSRF, Accept: "application/json" };
  let sendMethod = method;
  if (["PUT", "PATCH", "DELETE"].includes(method)) {
    headers["X-HTTP-Method-Override"] = method;
    sendMethod = "POST";
  }
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(url, { method: sendMethod, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError("NETWORK", "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new ApiError("BAD_RESPONSE", "Respons server tidak terbaca. Muat ulang halaman lalu coba lagi.");
  if (!res.ok || data.error) {
    if (data.error?.code === "UNAUTHORIZED") location.href = "/login";
    throw new ApiError(data.error?.code ?? "UNKNOWN", data.error?.message ?? "Terjadi kesalahan. Coba lagi.");
  }
  return data.data;
}

/** Aksi AI bertahap: panggil berulang sampai { pending: false }. onProgress menerima pesan tiap tahap. */
async function apiSteps(url, json, onProgress) {
  for (let i = 0; i < 10; i++) {
    const r = await api(url, { method: "POST", json });
    if (!r.pending) return r;
    onProgress?.(r.message);
  }
  throw new ApiError("LLM_FAILED", "Proses terlalu lama. Coba lagi.");
}

const errorMessage = (e) => (e instanceof ApiError ? e.message : "Terjadi kesalahan. Coba lagi.");
const band1 = (b) => Number(b).toFixed(1);

/** Membuat elemen DOM: h("div", { class: "card", onclick: fn }, child1, "teks", ...). */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k === "value") el.value = v;
    else if (k === "disabled" || k === "checked" || k === "open" || k === "selected") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Ganti isi elemen; null/false diabaikan (replaceChildren menulis "null"). */
function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function errorBanner(message) {
  return message ? h("div", { role: "alert", class: "banner-error" }, message) : null;
}

function busyText(text) {
  return h("span", { class: "muted" }, text);
}

async function copyText(text, button, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Tersalin";
    setTimeout(() => (button.textContent = label), 2000);
  } catch {
    /* clipboard ditolak browser */
  }
}

/** Bagian 4.1 (sama dengan count_words di PHP): jumlah kata, kata salinan soal (>= 5 kata berurutan) tidak dihitung. */
function countWords(essay, prompt) {
  const words = (text) =>
    text
      .split(/\s+/)
      .filter((t) => t !== "" && /[\p{L}\p{N}&%$£€]/u.test(t))
      .map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  const e = words(essay);
  const p = words(prompt);
  let excluded = 0;
  if (p.length >= COPY_MIN_RUN) {
    const grams = new Set();
    for (let i = 0; i + COPY_MIN_RUN <= p.length; i++) grams.add(p.slice(i, i + COPY_MIN_RUN).join(" "));
    const copied = new Array(e.length).fill(false);
    for (let i = 0; i + COPY_MIN_RUN <= e.length; i++) {
      if (grams.has(e.slice(i, i + COPY_MIN_RUN).join(" "))) for (let j = i; j < i + COPY_MIN_RUN; j++) copied[j] = true;
    }
    excluded = copied.filter(Boolean).length;
  }
  return { total: e.length, excluded, counted: e.length - excluded };
}

// Form POST biasa: cegah klik ganda.
document.addEventListener("submit", (ev) => {
  const form = ev.target;
  if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-once")) return;
  if (form.dataset.sent) {
    ev.preventDefault();
    return;
  }
  form.dataset.sent = "1";
  form.querySelectorAll("button").forEach((b) => (b.disabled = true));
});

// ---------------------------------------------------------------- editor data grafik

const CHART_TYPE_LABELS = {
  line: "Grafik garis",
  bar: "Grafik batang",
  pie: "Diagram lingkaran",
  table: "Tabel",
  process: "Diagram proses",
  map: "Peta",
  mixed: "Campuran",
  other: "Lainnya",
};

function emptyExtractedData() {
  return {
    chart_type: "other",
    title: "",
    units: "",
    tables: [{ name: "Data", columns: ["", ""], rows: [{ label: "", values: ["", ""] }] }],
    process_steps: [],
    map_changes: [],
    notes: [],
  };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Editor data grafik. Mengubah `data` (objek) langsung; perubahan struktur (baris/kolom/tabel) menggambar ulang editor.
 * Mengembalikan elemen wadah.
 */
function extractionEditor(data, { uncertain = null, disabled = false } = {}) {
  const cells = Array.isArray(uncertain) ? uncertain : [];
  const box = h("div", { class: "stack" });

  function redraw() {
    setChildren(box, ...build());
  }

  function input(props, get, set) {
    return h("input", { ...props, value: get(), disabled, oninput: (e) => set(e.target.value) });
  }

  function build() {
    const out = [];
    out.push(
      h("div", null,
        h("label", { class: "label label-sm" }, "Jenis grafik"),
        h("select", { class: "input", disabled, onchange: (e) => (data.chart_type = e.target.value) },
          Object.entries(CHART_TYPE_LABELS).map(([k, label]) => h("option", { value: k, selected: data.chart_type === k }, label)),
        ),
      ),
      h("div", { class: "grid-2" },
        h("div", null, h("label", { class: "label label-sm" }, "Judul"),
          input({ class: "input" }, () => data.title, (v) => (data.title = v))),
        h("div", null, h("label", { class: "label label-sm" }, "Satuan"),
          input({ class: "input" }, () => data.units, (v) => (data.units = v))),
      ),
    );

    data.tables.forEach((t, ti) => {
      const head = h("tr", null, h("th", null, "Baris"),
        t.columns.map((c, ci) =>
          h("th", null, h("div", { class: "row-sm", style: "flex-wrap:nowrap;gap:4px" },
            input({ class: "cell head", "aria-label": `Kolom ${ci + 1}`, placeholder: `Kolom ${ci + 1}` }, () => t.columns[ci], (v) => (t.columns[ci] = v)),
            t.columns.length > 1 && !disabled
              ? h("button", { type: "button", class: "icon-btn", "aria-label": `Hapus kolom ${ci + 1}`, onclick: () => {
                  t.columns.splice(ci, 1);
                  t.rows.forEach((r) => r.values.splice(ci, 1));
                  redraw();
                } }, "✕")
              : null,
          )),
        ),
        h("th"),
      );
      const body = t.rows.map((r, ri) =>
        h("tr", { class: ri % 2 === 0 ? "zebra" : "" },
          h("td", null, input({ class: "cell", "aria-label": `Label baris ${ri + 1}` }, () => r.label, (v) => (r.label = v))),
          t.columns.map((col, ci) => {
            const u = cells.find((c) => c.table === t.name && c.row === r.label && c.column === col);
            return h("td", null, input(
              { class: `cell${u ? " uncertain" : ""}`, title: u ? `Bacaan 1: ${u.a} · Bacaan 2: ${u.b}` : null, "aria-label": `${r.label} ${col}` },
              () => r.values[ci] ?? "",
              (v) => {
                while (r.values.length < t.columns.length) r.values.push("");
                r.values[ci] = v;
              },
            ));
          }),
          h("td", null, disabled ? null : h("button", { type: "button", class: "icon-btn", "aria-label": "Hapus baris", onclick: () => {
            t.rows.splice(ri, 1);
            redraw();
          } }, "✕")),
        ),
      );
      out.push(
        h("div", { class: "table-box" },
          input({ class: "input semibold", "aria-label": "Nama tabel", style: "margin-bottom:8px" }, () => t.name, (v) => (t.name = v)),
          h("div", { class: "data-table-wrap" }, h("table", { class: "data-table" }, h("thead", null, head), h("tbody", null, body))),
          disabled ? null : h("div", { class: "row", style: "margin-top:8px;gap:16px" },
            h("button", { type: "button", class: "link-btn", onclick: () => {
              t.rows.push({ label: "", values: t.columns.map(() => "") });
              redraw();
            } }, "+ Tambah baris"),
            h("button", { type: "button", class: "link-btn", onclick: () => {
              t.columns.push("");
              t.rows.forEach((r) => r.values.push(""));
              redraw();
            } }, "+ Tambah kolom"),
            h("button", { type: "button", class: "link-btn danger", onclick: () => {
              data.tables.splice(ti, 1);
              redraw();
            } }, "Hapus tabel"),
          ),
        ),
      );
    });
    if (!disabled) {
      out.push(h("button", { type: "button", class: "link-btn", onclick: () => {
        data.tables.push({ name: `Tabel ${data.tables.length + 1}`, columns: ["", ""], rows: [{ label: "", values: ["", ""] }] });
        redraw();
      } }, "+ Tambah tabel"));
    }
    out.push(listEditor("Tahapan proses", data.process_steps), listEditor("Perubahan peta", data.map_changes));
    return out.filter(Boolean);
  }

  function listEditor(label, items) {
    if (items.length === 0 && disabled) return null;
    return h("div", null,
      h("p", { class: "label label-sm" }, label),
      h("ol", { class: "stack-sm" }, items.map((it, i) =>
        h("li", { class: "row-sm", style: "flex-wrap:nowrap" },
          h("span", { class: "small muted" }, `${i + 1}.`),
          input({ class: "input", "aria-label": `${label} ${i + 1}` }, () => items[i], (v) => (items[i] = v)),
          disabled ? null : h("button", { type: "button", class: "icon-btn", "aria-label": "Hapus", onclick: () => {
            items.splice(i, 1);
            redraw();
          } }, "✕"),
        ))),
      disabled ? null : h("button", { type: "button", class: "link-btn", style: "margin-top:8px", onclick: () => {
        items.push("");
        redraw();
      } }, "+ Tambah"),
    );
  }

  redraw();
  return box;
}

// ---------------------------------------------------------------- hasil penilaian

function criteriaBlocks(criteria) {
  return h("div", { class: "stack" }, criteria.map((c) =>
    h("section", { class: "criterion" },
      h("h3", null, c.name),
      h("p", { class: "band" }, band1(c.band)),
      h("p", { class: "feedback" }, c.feedback),
      c.tip ? h("p", { class: "tip" }, c.tip) : null,
    )));
}

function resultCopyText(criteria, taskBand) {
  const blocks = criteria.map((c) => [c.name, band1(c.band), c.feedback, ...(c.tip ? [c.tip] : [])].join("\n"));
  return [...blocks, `Overall: ${band1(taskBand)}`].join("\n\n");
}

function resultView(result, { polishAction, reviseAction }) {
  const factErrors = result.fact_errors ?? [];
  const copyBtn = h("button", { type: "button", class: "btn-secondary", onclick: (e) => copyText(resultCopyText(result.criteria, result.task_band), e.currentTarget, "Salin hasil") }, "Salin hasil");
  return h("div", { class: "stack-lg" },
    h("p", { class: "small muted" }, `Jumlah kata: ${result.word_count.counted} (minimal ${result.word_count.min})`),
    criteriaBlocks(result.criteria),
    h("p", { class: "overall" }, "Overall: ", h("span", { class: "badge-accent" }, band1(result.task_band))),
    result.task_type === "task1_academic" && factErrors.length > 0
      ? h("details", { class: "card" },
          h("summary", null, `Kesalahan data yang ditemukan (${factErrors.length})`),
          h("ul", { class: "stack-sm", style: "margin-top:12px" }, factErrors.map((f) =>
            h("li", { class: "fact-item" },
              h("p", { class: "italic" }, `“${f.essay_quote}”`),
              h("p", { style: "margin-top:4px" }, h("span", { class: "semibold" }, "Masalah: "), f.issue),
              h("p", { style: "margin-top:4px" }, h("span", { class: "semibold" }, "Data yang benar: "), f.correct_info),
            ))))
      : null,
    h("p", { class: "small muted" }, "Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS."),
    h("div", { class: "row-sm" }, polishAction, copyBtn, reviseAction),
  );
}

const MARK_TYPES = {
  content: "Konten",
  data: "Data",
  cohesion: "Koherensi & kohesi",
  vocab: "Kosakata",
  grammar: "Grammar",
};

function polishedPanel(p) {
  const t1 = p.task_type === "task1_academic";
  const groups = [
    [t1 ? "Task Achievement" : "Task Response", t1 ? ["content", "data"] : ["content"]],
    ["Coherence & Cohesion", ["cohesion"]],
    ["Lexical Resource", ["vocab"]],
    ["Grammatical Range & Accuracy", ["grammar"]],
  ];
  const original = h("div", { class: "essay-box" }, p.original_segments.map((s) =>
    s.mark
      ? h("span", { class: `mark mark-${s.mark.type}`, tabindex: "0" }, s.text,
          h("span", { role: "tooltip", class: "tooltip" },
            h("span", { class: "t-title" }, h("span", { class: `dot dot-${s.mark.type}` }), MARK_TYPES[s.mark.type]),
            h("span", { style: "display:block" }, s.mark.issue),
            h("span", { style: "display:block;margin-top:4px" }, "Seharusnya: ", h("span", { class: "t-fix" }, s.mark.correction)),
          ))
      : s.text));
  const copyBtn = h("button", { type: "button", class: "btn-secondary", onclick: (e) => copyText(p.polished_text, e.currentTarget, "Salin esai") }, "Salin esai");
  return h("section", { class: "card stack polished-section" },
    h("h2", { style: "font-size:20px;font-weight:700" }, "Versi polished — target band ", h("span", { class: "badge-accent" }, band1(p.target_band))),
    h("div", { class: "polished-grid" },
      h("div", { class: "stack-sm" },
        h("h3", { class: "bold" }, "Tulisan kamu"),
        p.has_corrections
          ? h("ul", { class: "legend small muted stack-sm" }, groups.map(([name, types]) =>
              h("li", null, h("span", { class: "semibold", style: "color:var(--ink)" }, `${name}:`),
                types.map((t) => h("span", null, h("span", { class: `dot dot-${t}` }), `${MARK_TYPES[t]} (${p.mark_counts[t] ?? 0})`)))))
          : h("p", { class: "banner-warning small" },
              "Versi polished ini dibuat sebelum penanda kesalahan lengkap ada",
              p.mark_total > 0 ? ", jadi hanya kesalahan data yang ditandai" : "",
              ". Untuk melihat kesalahan konten, koherensi, kosakata, dan grammar, pakai \"Revisi & nilai ulang\" lalu buka versi polished yang baru."),
        p.mark_total > 0 ? h("p", { class: "small muted" }, "Arahkan kursor (atau ketuk) bagian yang disorot untuk melihat koreksinya.") : null,
        original,
      ),
      h("div", { class: "stack-sm" },
        h("h3", { class: "bold" }, "Versi polished"),
        h("p", { class: "small muted" }, `Skor ulang versi ini: ${band1(p.rescored_task_band)}`),
        h("div", { class: "polished-box" }, p.polished_text.split(/\n\s*\n/).map((para) => h("p", { class: "prewrap" }, para.trim()))),
      ),
    ),
    h("details", null, h("summary", null, "Lihat penilaian versi polished"), h("div", { style: "margin-top:12px" }, criteriaBlocks(p.rescored_criteria))),
    h("div", null, copyBtn),
  );
}

// ---------------------------------------------------------------- alur latihan (TaskFlow)

const TASK_TITLES = { task1_academic: "Task 1 Academic", task2: "Task 2" };
const AUTOSAVE_MS = 2000;

/**
 * Satu latihan (Task 1 / Task 2) dari soal sampai hasil.
 * opts.onChange(detail) dipanggil setiap detail berubah; opts.afterResult() mengembalikan elemen tambahan di bawah hasil.
 */
function taskFlow(root, initial, opts = {}) {
  const minWords = window.PAGE?.minWords ?? { task1_academic: 150, task2: 250 };
  const s = {
    detail: initial,
    promptText: initial.prompt_text,
    essay: initial.essay_text,
    task2Answering: initial.essay_text.trim() !== "",
    busy: null,
    progress: null,
    manual: false,
    draft: null, // salinan data grafik yang sedang diedit di langkah konfirmasi
    showPolished: false,
    error: null,
  };
  let autosaveTimer = null;
  let lastSavedEssay = initial.essay_text;

  const isTask1 = () => s.detail.task_type === "task1_academic";
  function step() {
    const st = s.detail.status;
    if (st === "graded") return "result";
    if (isTask1()) return st === "draft" ? (s.manual ? "confirm" : "prompt") : st === "extracted" ? "confirm" : "answer";
    return s.task2Answering ? "answer" : "prompt";
  }

  function setDetail(d) {
    s.detail = d;
    opts.onChange?.(d);
  }

  function set(patch) {
    Object.assign(s, patch);
    render();
  }

  async function savePrompt() {
    return api(`/api/submissions/${s.detail.id}`, { method: "PATCH", json: { prompt_text: s.promptText } });
  }

  async function reload() {
    setDetail(await api(`/api/submissions/${s.detail.id}`));
  }

  async function action(name, fn) {
    set({ busy: name, error: null, progress: null });
    try {
      await fn();
      s.error = null;
    } catch (e) {
      s.error = errorMessage(e);
    }
    set({ busy: null, progress: null });
  }

  const onTask2Next = () => {
    if (!s.promptText.trim() && !s.detail.prompt_image_url) return set({ error: "Isi soal dulu (teks atau gambar)." });
    action("save", async () => {
      setDetail(await savePrompt());
      s.task2Answering = true;
    });
  };

  const onExtract = () => {
    if (!s.detail.prompt_image_url) return set({ error: "Task 1 wajib menyertakan gambar soal." });
    action("extract", async () => {
      try {
        if (s.promptText !== s.detail.prompt_text) await savePrompt();
        await api(`/api/submissions/${s.detail.id}/extract`, { method: "POST", json: {} });
        s.draft = null;
      } finally {
        await reload().catch(() => {});
      }
    });
  };

  const onManual = () => {
    if (!s.promptText.trim() && !s.detail.prompt_image_url) return set({ error: "Isi soal dulu (teks atau gambar)." });
    action("save", async () => {
      if (s.promptText !== s.detail.prompt_text) setDetail(await savePrompt());
      s.manual = true;
      s.draft = null;
    });
  };

  const onConfirm = (data) =>
    action("confirm", async () => {
      await api(`/api/submissions/${s.detail.id}/extracted-data`, { method: "PUT", json: { extracted_data: data } });
      s.manual = false;
      s.draft = null;
      setDetail({ ...s.detail, extracted_data: data, status: "confirmed" });
    });

  const onGrade = () =>
    action("grade", async () => {
      clearTimeout(autosaveTimer);
      const r = await apiSteps(`/api/submissions/${s.detail.id}/grade`, { essay_text: s.essay }, (msg) => set({ progress: msg }));
      setDetail({ ...s.detail, essay_text: s.essay, status: "graded", result: r.result, last_error_code: null });
    });

  const onPolish = () => {
    if (s.detail.polished) return set({ showPolished: true });
    action("polish", async () => {
      const r = await apiSteps(`/api/submissions/${s.detail.id}/polish`, {}, (msg) => set({ progress: msg }));
      setDetail({ ...s.detail, polished: r.polished });
      s.showPolished = true;
    });
  };

  const onRevise = () =>
    action("revise", async () => {
      const { id } = await api(`/api/submissions/${s.detail.id}/revise`, { method: "POST", json: {} });
      location.href = `/submissions/${id}`;
      await new Promise(() => {}); // tetap "sibuk" sampai halaman berpindah
    });

  function stepsBar(current) {
    const steps = isTask1()
      ? [["prompt", "Soal"], ["confirm", "Konfirmasi data"], ["answer", "Jawaban"], ["result", "Hasil"]]
      : [["prompt", "Soal"], ["answer", "Jawaban"], ["result", "Hasil"]];
    const idx = steps.findIndex(([k]) => k === current);
    return h("ol", { class: "steps" }, steps.map(([, label], i) =>
      h("li", { class: `step${i === idx ? " current" : i < idx ? " done" : ""}` }, `${i + 1}. ${label}`)));
  }

  // ---- langkah Soal
  function questionPicker() {
    const box = h("div", { class: "card stack-sm" }, h("p", { class: "muted small" }, "Memuat database soal…"));
    api(`/api/questions?task_type=${s.detail.task_type}`).then((list) => {
      let selected = "";
      let err = null;
      const draw = () => {
        const select = h("select", { class: "input grow", "aria-label": "Soal dari database", disabled: s.busy !== null, onchange: (e) => {
          selected = e.target.value;
          useBtn.disabled = !selected || s.busy !== null;
        } }, h("option", { value: "" }, "— Pilih soal —"), list.map((q) => h("option", { value: q.id }, q.name)));
        const useBtn = h("button", { type: "button", class: "btn-primary", disabled: true, onclick: async () => {
          useBtn.disabled = true;
          useBtn.textContent = "Memuat…";
          try {
            const d = await api(`/api/submissions/${s.detail.id}/use-question`, { method: "POST", json: { question_id: selected } });
            setDetail(d);
            s.promptText = d.prompt_text;
            if (d.task_type === "task2") s.task2Answering = true;
            set({ error: null });
          } catch (e) {
            err = errorMessage(e);
            draw();
          }
        } }, "Pakai soal ini");
        setChildren(box, 
          h("div", { class: "row", style: "justify-content:space-between;gap:8px" },
            h("p", { class: "semibold" }, "Pilih dari database soal"),
            h("a", { href: "/questions", class: "small semibold text-primary" }, "Lihat database soal")),
          list.length === 0
            ? h("p", { class: "small muted" }, `Belum ada soal ${isTask1() ? "Task 1" : "Task 2"} di database. Masukkan soal baru di bawah, lalu simpan ke database setelah selesai.`)
            : h("div", { class: "row-sm" }, select, useBtn),
          errorBanner(err),
          h("p", { class: "small muted" }, "Atau masukkan soal baru:"),
        );
      };
      draw();
    }).catch(() => box.remove());
    return box;
  }

  function imageInput() {
    const d = s.detail;
    const fileInput = h("input", { type: "file", accept: IMAGE_TYPES.join(","), class: "hidden", onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) upload(f);
    } });
    async function upload(file) {
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) return set({ error: "Gambar harus PNG, JPG, atau WEBP dan maksimal 5 MB." });
      action("upload", async () => {
        const fd = new FormData();
        fd.append("file", file);
        await api(`/api/submissions/${d.id}/image`, { method: "POST", body: fd });
        await reload();
        s.detail.prompt_image_url &&= `${s.detail.prompt_image_url}?v=${Date.now()}`;
      });
    }
    imageInput.upload = upload;
    if (d.prompt_image_url) {
      return h("div", { class: "card stack-sm" },
        h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img" }),
        h("div", { class: "row-sm" },
          h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: () => fileInput.click() }, "Ganti gambar"),
          h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: () =>
            action("upload", async () => {
              await api(`/api/submissions/${d.id}/image`, { method: "DELETE" });
              await reload();
            }) }, "Hapus gambar")),
        fileInput);
    }
    const zone = h("button", { type: "button", class: "dropzone", disabled: s.busy !== null, onclick: () => fileInput.click(),
      ondragover: (e) => { e.preventDefault(); zone.classList.add("over"); },
      ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      } },
      h("span", { class: "semibold text-primary" }, s.busy === "upload" ? "Mengunggah…" : "Pilih gambar soal"),
      h("span", { class: "small muted", style: "margin-top:4px" }, "Klik, seret file ke sini, atau tempel (Ctrl+V). PNG, JPG, WEBP, maks. 5 MB."));
    return h("div", null, zone, fileInput);
  }

  function promptStep() {
    const t1 = isTask1();
    return h("div", { class: "stack" },
      questionPicker(),
      h("div", null,
        h("label", { class: "label", for: "prompt" }, "Teks soal"),
        h("textarea", { id: "prompt", class: "input", style: "min-height:128px", maxlength: "5000", placeholder: "Tempel teks soal di sini.",
          value: s.promptText, oninput: (e) => (s.promptText = e.target.value) })),
      h("div", null,
        h("p", { class: "label" }, "Gambar soal ", t1 ? "(wajib, kecuali data grafik diisi manual)" : "(opsional)"),
        imageInput()),
      errorBanner(s.error),
      t1
        ? h("div", { class: "row" },
            h("button", { type: "button", class: "btn-primary", disabled: s.busy !== null, onclick: onExtract }, "Baca data grafik"),
            h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: onManual }, "Isi data manual"),
            s.busy === "extract" ? busyText("Sedang membaca grafik… biasanya 10–40 detik") : null)
        : h("button", { type: "button", class: "btn-primary", disabled: s.busy !== null, onclick: onTask2Next }, "Lanjut"),
    );
  }

  // ---- langkah Konfirmasi data
  function confirmStep() {
    const d = s.detail;
    s.draft ??= clone(d.extracted_data ?? emptyExtractedData());
    const data = s.draft;
    const manual = s.manual;
    const mismatch = d.extraction_uncertain && !Array.isArray(d.extraction_uncertain);
    return h("div", { class: "stack" },
      mismatch ? h("p", { class: "banner-warning" }, "Grafik ini sulit dibaca. Cek semua angka dengan teliti.") : null,
      h("p", { class: "small muted" }, manual
        ? "Ketik data dari grafik: judul kolom (mis. tahun), label baris, dan angkanya. Data ini dipakai untuk mengecek ketepatan angka di jawabanmu."
        : "Periksa data hasil bacaan grafik. Data ini dipakai untuk mengecek ketepatan angka di jawabanmu. Sel kuning berarti dua kali pembacaan memberi hasil berbeda."),
      h("div", { class: "grid-2" },
        h("div", { class: "stack-sm" },
          d.prompt_image_url ? h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img-lg" }) : null,
          !d.prompt_image_url && d.prompt_text ? h("p", { class: "card prewrap small" }, d.prompt_text) : null),
        extractionEditor(data, { uncertain: d.extraction_uncertain, disabled: s.busy !== null })),
      errorBanner(s.error),
      h("div", { class: "row" },
        manual
          ? h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: () => set({ manual: false, draft: null, error: null }) }, "Kembali ke soal")
          : h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: onExtract }, "Baca ulang"),
        h("button", { type: "button", class: "btn-primary", disabled: s.busy !== null, onclick: () => onConfirm(data) }, "Data sudah benar, lanjut"),
        s.busy === "extract" ? busyText("Sedang membaca grafik… biasanya 10–40 detik") : null),
    );
  }

  // ---- langkah Jawaban
  function answerStep() {
    const d = s.detail;
    const min = minWords[d.task_type];
    const counter = h("p", { class: "small" });
    const saveState = h("p", { class: "small muted" });
    const updateCount = () => {
      const wc = countWords(s.essay, d.prompt_text);
      counter.className = wc.counted < min ? "small wordcount-low" : "small muted";
      counter.textContent = `Kata: ${wc.counted} / minimal ${min}` + (wc.excluded > 0 ? ` (${wc.excluded} kata salinan dari soal tidak dihitung)` : "");
    };
    const grading = s.busy === "grade";
    const textarea = h("textarea", { id: "essay", class: "input essay", maxlength: "10000", placeholder: "Tulis jawabanmu dalam bahasa Inggris.",
      value: s.essay, disabled: grading, oninput: (e) => {
        s.essay = e.target.value;
        updateCount();
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(async () => {
          if (s.essay === lastSavedEssay || s.busy === "grade") return;
          saveState.textContent = "Menyimpan draf…";
          try {
            const text = s.essay;
            await api(`/api/submissions/${d.id}`, { method: "PATCH", json: { essay_text: text } });
            lastSavedEssay = text;
            saveState.textContent = "Draf tersimpan";
          } catch {
            saveState.textContent = "Draf gagal disimpan";
          }
        }, AUTOSAVE_MS);
      } });
    updateCount();
    return h("div", { class: "stack" },
      h("details", { class: "card", open: true },
        h("summary", null, "Soal", d.question ? h("span", { class: "muted", style: "font-weight:400" }, ` · ${d.question.name}`) : null),
        h("div", { class: "stack-sm", style: "margin-top:12px" },
          d.prompt_text ? h("p", { class: "prewrap" }, d.prompt_text) : null,
          d.prompt_image_url ? h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img", style: "max-height:320px" }) : null)),
      h("div", null,
        h("label", { class: "label", for: "essay" }, "Jawaban"),
        textarea,
        h("div", { class: "row", style: "justify-content:space-between;gap:8px;margin-top:4px" }, counter, saveState)),
      errorBanner(s.error),
      h("div", { class: "row" },
        !isTask1() ? h("button", { type: "button", class: "btn-secondary", disabled: grading, onclick: () => set({ task2Answering: false, error: null }) }, "Kembali ke soal") : null,
        h("button", { type: "button", class: "btn-primary", disabled: s.busy !== null, onclick: onGrade }, "Nilai jawaban"),
        grading ? busyText(s.progress ?? "Sedang menilai… biasanya 15–40 detik per tahap") : null),
    );
  }

  // ---- simpan ke database soal
  function saveQuestion() {
    const d = s.detail;
    if (d.question) {
      return h("p", { class: "small muted" }, "Soal ini ada di database soal: ", h("span", { class: "semibold", style: "color:var(--ink)" }, d.question.name));
    }
    let err = null;
    const box = h("div", { class: "card stack-sm" });
    const nameInput = h("input", { class: "input grow", "aria-label": "Nama soal", maxlength: "150",
      placeholder: isTask1() ? "mis. Cambridge 17 Test 1 Task 1" : "mis. Cambridge 17 Test 1 Task 2" });
    const btn = h("button", { type: "button", class: "btn-secondary", onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        err = "Isi nama soal dulu.";
        return draw();
      }
      btn.disabled = true;
      btn.textContent = "Menyimpan…";
      try {
        const q = await api("/api/questions", { method: "POST", json: { submission_id: d.id, name } });
        setDetail({ ...s.detail, question: { id: q.id, name: q.name } });
        render();
      } catch (e) {
        err = errorMessage(e);
        btn.disabled = false;
        btn.textContent = "Simpan";
        draw();
      }
    } }, "Simpan");
    const draw = () => setChildren(box, 
      h("div", null,
        h("p", { class: "semibold" }, "Simpan soal ke database soal"),
        h("p", { class: "small muted" }, `Pengguna lain bisa memakai soal ini tanpa perlu membaca ${isTask1() ? "grafik" : "soal"} ulang.`)),
      h("div", { class: "row-sm" }, nameInput, btn),
      errorBanner(err));
    draw();
    return box;
  }

  // ---- hasil
  function resultStep() {
    const d = s.detail;
    return h("div", { class: "stack-lg" },
      resultView(d.result, {
        polishAction: d.result.polish_target !== null
          ? h("button", { type: "button", class: "btn-primary", disabled: s.busy !== null, onclick: onPolish }, `Lihat versi polished (target band ${band1(d.result.polish_target)})`)
          : null,
        reviseAction: h("button", { type: "button", class: "btn-secondary", disabled: s.busy !== null, onclick: onRevise }, "Revisi & nilai ulang"),
      }),
      errorBanner(s.error),
      s.busy === "polish" ? h("p", { class: "muted" }, s.progress ?? "Sedang menulis ulang… biasanya 30–60 detik per tahap") : null,
      s.showPolished && d.polished ? polishedPanel(d.polished) : null,
      opts.afterResult?.() ?? null,
    );
  }

  function render() {
    const current = step();
    setChildren(root, h("div", { class: "stack-lg" },
      stepsBar(current),
      h("h1", { class: "page-title" }, TASK_TITLES[s.detail.task_type]),
      current === "prompt" ? promptStep() : null,
      current === "confirm" ? confirmStep() : null,
      current === "answer" ? answerStep() : null,
      current === "result" && s.detail.result ? resultStep() : null,
      current === "answer" || current === "result" ? saveQuestion() : null,
    ));
  }

  // Tempel gambar dari clipboard di langkah Soal.
  const onPaste = (e) => {
    if (step() !== "prompt" || s.busy !== null || !root.isConnected) return;
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
    if (file && imageInput.upload) {
      e.preventDefault();
      imageInput.upload(file);
    }
  };
  window.addEventListener("paste", onPaste);

  render();
  return { destroy: () => window.removeEventListener("paste", onPaste), render };
}

// ---------------------------------------------------------------- sesi Writing lengkap

function sessionFlow(root, initial) {
  let view = initial;
  let stepKey = view.task1?.status === "graded" && view.task2?.status === "graded" ? "summary" : view.task2 ? "task2" : "task1";
  let busy = false;
  let error = null;
  let flow = null;
  const sid = view.session.id;

  const reload = async () => (view = await api(`/api/sessions/${sid}`));
  const bothGraded = () => view.task1?.status === "graded" && view.task2?.status === "graded";

  async function createTask(type) {
    busy = true;
    error = null;
    render();
    try {
      await api("/api/submissions", { method: "POST", json: { task_type: type, session_id: sid } });
    } catch (e) {
      if (e.code !== "SESSION_SLOT_TAKEN") error = errorMessage(e);
    }
    try {
      await reload();
      stepKey = type === "task1_academic" ? "task1" : "task2";
    } catch (e) {
      error = errorMessage(e);
    }
    busy = false;
    render();
  }

  function summary() {
    const t1 = view.task1.result;
    const t2 = view.task2.result;
    const { writing_band: wb, writing_band_raw: wr } = view.session;
    return h("div", { class: "card stack-sm" },
      h("h1", { class: "page-title" }, "Ringkasan"),
      h("p", null, `Task 1: ${band1(t1.task_band)}`),
      h("p", null, `Task 2: ${band1(t2.task_band)}`),
      wb !== null && wr !== null
        ? [h("p", { class: "writing-band" }, "Skor Writing: ", h("span", { class: "badge-accent" }, band1(wb))),
           h("p", { class: "small muted" }, `(Task 1 + 2 × Task 2) / 3 = ${wr.toFixed(2)} → dibulatkan ke ${band1(wb)}`)]
        : h("p", { class: "muted" }, "Skor Writing sedang dihitung…"),
      h("div", { class: "row small semibold", style: "padding-top:8px" },
        h("a", { href: `/submissions/${view.task1.id}`, class: "text-primary" }, "Lihat hasil Task 1"),
        h("a", { href: `/submissions/${view.task2.id}`, class: "text-primary" }, "Lihat hasil Task 2")),
      h("p", { class: "small muted" }, "Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS."),
    );
  }

  function render() {
    flow?.destroy();
    flow = null;
    const steps = [["task1", "Task 1", !!view.task1], ["task2", "Task 2", !!view.task2], ["summary", "Ringkasan", bothGraded()]];
    const nav = h("nav", { class: "row-sm small", "aria-label": "Langkah sesi" }, steps.map(([k, label, enabled], i) => [
      i > 0 ? h("span", { class: "step-sep" }, "→") : null,
      h("button", { type: "button", class: `step${stepKey === k ? " current" : enabled ? " done" : ""}`, disabled: !enabled, onclick: () => {
        stepKey = k;
        render();
      } }, label),
    ]));
    const body = h("div");
    setChildren(root, h("div", { class: "stack-lg" }, nav, errorBanner(error), body));

    if (stepKey === "summary" && bothGraded()) return body.append(summary());
    const key = stepKey === "task2" ? "task2" : "task1";
    const sub = view[key];
    if (!sub) {
      body.append(h("button", { type: "button", class: "btn-primary", disabled: busy, onclick: () => createTask(key === "task1" ? "task1_academic" : "task2") }, `Mulai ${key === "task1" ? "Task 1" : "Task 2"}`));
      return;
    }
    flow = taskFlow(body, sub, {
      onChange: (d) => {
        const wasGraded = view[key]?.status === "graded";
        view = { ...view, [key]: d };
        if (key === "task2" && d.status === "graded" && !wasGraded) {
          reload().then(() => {
            stepKey = "summary";
            render();
          });
        }
      },
      afterResult: () => key === "task1"
        ? h("div", { style: "padding-top:8px" }, h("button", { type: "button", class: "btn-primary", disabled: busy, onclick: () => {
            if (view.task2) {
              stepKey = "task2";
              render();
            } else createTask("task2");
          } }, "Lanjut ke Task 2"))
        : bothGraded()
          ? h("div", { style: "padding-top:8px" }, h("button", { type: "button", class: "btn-primary", onclick: () => {
              stepKey = "summary";
              render();
            } }, "Lihat ringkasan"))
          : null,
    });
  }

  render();
}

// ---------------------------------------------------------------- database soal

function questionBank(root, initial) {
  let questions = initial;
  const sections = [["task1_academic", "Task 1 Academic"], ["task2", "Task 2"]];

  function item(q) {
    const isTask1 = q.task_type === "task1_academic";
    let editing = false;
    let confirmDelete = false;
    let busy = false;
    let err = null;
    let name = q.name;
    let prompt = q.prompt_text;
    let data = clone(q.extracted_data ?? emptyExtractedData());
    const details = h("details", { class: "card" });
    const body = h("div", { class: "stack", style: "margin-top:16px" });

    function draw() {
      const actions = !q.can_edit ? null : editing
        ? h("div", { class: "row" },
            h("button", { type: "button", class: "btn-primary", disabled: busy, onclick: save }, busy ? "Menyimpan…" : "Simpan perubahan"),
            h("button", { type: "button", class: "btn-secondary", disabled: busy, onclick: () => {
              editing = false;
              err = null;
              name = q.name;
              prompt = q.prompt_text;
              data = clone(q.extracted_data ?? emptyExtractedData());
              draw();
            } }, "Batal"))
        : confirmDelete
          ? h("div", { class: "row" },
              h("span", { class: "semibold" }, "Hapus soal ini dari database?"),
              h("button", { type: "button", class: "btn-primary btn-danger", disabled: busy, onclick: del }, "Ya, hapus"),
              h("button", { type: "button", class: "btn-secondary", disabled: busy, onclick: () => {
                confirmDelete = false;
                draw();
              } }, "Batal"))
          : h("div", { class: "row" },
              h("button", { type: "button", class: "btn-secondary", onclick: () => {
                editing = true;
                draw();
              } }, "Edit"),
              h("button", { type: "button", class: "link-btn danger", style: "font-size:16px", onclick: () => {
                confirmDelete = true;
                draw();
              } }, "Hapus"));
      setChildren(body, ...[
        editing
          ? [h("div", null, h("label", { class: "label label-sm" }, "Nama soal"),
               h("input", { class: "input", maxlength: "150", value: name, disabled: busy, oninput: (e) => (name = e.target.value) })),
             h("div", null, h("label", { class: "label label-sm" }, "Teks soal"),
               h("textarea", { class: "input", style: "min-height:112px", maxlength: "5000", value: prompt, disabled: busy, oninput: (e) => (prompt = e.target.value) }))]
          : q.prompt_text ? h("p", { class: "prewrap" }, q.prompt_text) : null,
        q.image_url ? h("img", { src: q.image_url, alt: `Gambar soal ${q.name}`, class: "prompt-img", loading: "lazy", style: "max-height:320px" }) : null,
        isTask1 ? h("div", null, h("p", { class: "label label-sm" }, "Data grafik"), extractionEditor(data, { disabled: !editing || busy })) : null,
        errorBanner(err),
        actions,
      ].flat().filter(Boolean));
    }

    async function save() {
      busy = true;
      err = null;
      draw();
      try {
        const updated = await api(`/api/questions/${q.id}`, { method: "PATCH", json: { name, prompt_text: prompt, ...(isTask1 ? { extracted_data: data } : {}) } });
        questions = questions.map((x) => (x.id === q.id ? updated : x));
        Object.assign(q, updated);
        editing = false;
        setChildren(summary, ...summaryContent());
      } catch (e) {
        err = errorMessage(e);
      }
      busy = false;
      draw();
    }

    async function del() {
      busy = true;
      err = null;
      draw();
      try {
        await api(`/api/questions/${q.id}`, { method: "DELETE" });
        questions = questions.filter((x) => x.id !== q.id);
        render();
      } catch (e) {
        err = errorMessage(e);
        busy = false;
        draw();
      }
    }

    const summaryContent = () => [
      h("span", { class: "semibold" }, q.name),
      h("span", { class: "small muted", style: "display:block;font-weight:400" }, `${q.created_by_name ? `oleh ${q.created_by_name} · ` : ""}${q.created_at_text}`),
    ];
    const summary = h("summary", null, ...summaryContent());
    details.append(summary, body);
    // Isi (gambar + editor) baru dibuat saat dibuka supaya halaman tetap ringan.
    details.addEventListener("toggle", () => {
      if (details.open && !body.hasChildNodes()) draw();
    });
    return details;
  }

  function render() {
    setChildren(root, h("div", { class: "stack-lg" },
      h("p", { class: "muted" }, "Soal yang disimpan pengguna bisa dipakai siapa saja saat membuat Task baru, tanpa perlu membaca grafik ulang. Simpan soal dari langkah Jawaban atau Hasil. Soal hanya bisa diubah oleh pembuatnya atau admin."),
      sections.map(([type, label]) => {
        const list = questions.filter((q) => q.task_type === type);
        return h("section", null,
          h("h2", { class: "section-title" }, label, h("span", { class: "muted", style: "font-weight:400" }, ` (${list.length})`)),
          list.length === 0 ? h("p", { class: "muted" }, "Belum ada soal.") : h("ul", { class: "stack-sm" }, list.map((q) => h("li", null, item(q)))));
      }),
    ));
  }

  render();
}

// ---------------------------------------------------------------- pengaturan AI (admin)

function settingsPage(root, { settings, providers }) {
  let saved = settings;
  const st = {
    provider: saved.provider ?? providers[0].value,
    model: saved.model ?? "",
    baseUrl: saved.base_url ?? "",
    apiKey: "",
    test: null,
    busy: null,
    error: null,
    notice: null,
  };
  const opt = () => providers.find((p) => p.value === st.provider) ?? providers[0];
  const signature = () => JSON.stringify([st.provider, st.model.trim(), opt().needsBaseUrl ? st.baseUrl.trim() : "", st.apiKey.trim()]);
  const body = () => ({ provider: st.provider, model: st.model.trim(), base_url: opt().needsBaseUrl ? st.baseUrl.trim() : null, api_key: st.apiKey.trim() || null });

  // Aturan sama dengan server: tes wajib kalau key baru diisi, atau key tersimpan dan provider/model/base URL berubah.
  function canSave() {
    const fieldsChanged = st.provider !== saved.provider || st.model.trim() !== (saved.model ?? "") || (opt().needsBaseUrl ? st.baseUrl.trim() : null) !== (saved.base_url ?? null);
    const llmChanged = st.apiKey.trim() !== "" || (saved.has_api_key && fieldsChanged);
    const passed = st.test?.ok === true && st.test.signature === signature();
    return st.busy === null && (!llmChanged || passed);
  }

  const refresh = () => {
    saveBtn.disabled = !canSave();
    testBtn.disabled = st.busy !== null || !st.model.trim();
    setChildren(testResult, st.test && st.test.signature === signature()
      ? st.test.ok
        ? h("p", { class: "badge-accent semibold", style: "display:inline-block;padding:4px 12px" }, `Berhasil (${st.test.latency_ms} ms)`)
        : h("p", { class: "banner-error" }, st.test.error)
      : "");
    const switched = saved.source !== "none" && (st.provider !== saved.provider || st.model.trim() !== (saved.model ?? ""));
    warn.classList.toggle("hidden", !switched);
  };

  const testBtn = h("button", { type: "button", class: "btn-secondary", onclick: async () => {
    st.busy = "test";
    st.error = st.notice = null;
    testBtn.textContent = "Menguji…";
    refresh();
    const sig = signature();
    try {
      st.test = { ...(await api("/api/settings/test", { method: "POST", json: body() })), signature: sig };
    } catch (e) {
      st.test = { ok: false, latency_ms: 0, error: errorMessage(e), signature: sig };
    }
    st.busy = null;
    testBtn.textContent = "Tes koneksi";
    refresh();
  } }, "Tes koneksi");
  const testResult = h("div");
  const warn = h("p", { class: "banner-warning hidden" }, "Mengganti model bisa mengubah hasil skor. Coba nilai beberapa jawaban contoh setelah menyimpan.");
  const errBox = h("div");
  const noticeBox = h("p", { class: "notice" });
  const saveBtn = h("button", { type: "submit", class: "btn-primary" }, "Simpan");

  const activeCard = () => h("div", { class: "card small" },
    h("p", { class: "semibold" }, "Pengaturan aktif"),
    saved.source === "none"
      ? h("p", { class: "muted", style: "margin-top:4px" }, "Belum dikonfigurasi (database dan config.php kosong).")
      : h("ul", { class: "muted stack-sm", style: "margin-top:4px" },
          h("li", null, "Model: ", h("span", { class: "semibold", style: "color:var(--ink)" }, `${saved.provider}:${saved.model}`)),
          h("li", null, `Sumber: ${saved.source}`),
          saved.updated_at ? h("li", null, `Terakhir diubah oleh ${saved.updated_by ?? "-"} pada ${saved.updated_at_text}`) : null));
  let active = activeCard();

  const baseUrlWrap = h("div", null,
    h("label", { class: "label", for: "baseUrl" }, "Base URL"),
    h("input", { id: "baseUrl", class: "input", maxlength: "500", placeholder: "https://...", value: st.baseUrl, oninput: (e) => { st.baseUrl = e.target.value; refresh(); } }));
  const modelInput = h("input", { id: "model", class: "input", maxlength: "200", value: st.model, placeholder: opt().modelPlaceholder, oninput: (e) => { st.model = e.target.value; refresh(); } });
  const keyInput = h("input", { id: "apiKey", type: "password", autocomplete: "off", class: "input", value: "",
    placeholder: saved.has_api_key && saved.api_key_last4 ? `•••• ${saved.api_key_last4} (kosongkan untuk tetap memakai key ini)` : "",
    oninput: (e) => { st.apiKey = e.target.value; refresh(); } });

  const form = h("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    if (!canSave()) return;
    st.busy = "save";
    st.error = st.notice = null;
    saveBtn.textContent = "Menyimpan…";
    refresh();
    try {
      saved = await api("/api/settings", { method: "PUT", json: body() });
      st.apiKey = "";
      keyInput.value = "";
      keyInput.placeholder = saved.has_api_key && saved.api_key_last4 ? `•••• ${saved.api_key_last4} (kosongkan untuk tetap memakai key ini)` : "";
      st.test = null;
      st.notice = "Pengaturan disimpan dan langsung berlaku.";
      const fresh = activeCard();
      active.replaceWith(fresh);
      active = fresh;
    } catch (err) {
      st.error = errorMessage(err);
    }
    st.busy = null;
    saveBtn.textContent = "Simpan";
    setChildren(errBox, errorBanner(st.error) ?? "");
    noticeBox.textContent = st.notice ?? "";
    refresh();
  } },
    h("div", null,
      h("label", { class: "label", for: "provider" }, "Provider"),
      h("select", { id: "provider", class: "input", onchange: (e) => {
        st.provider = e.target.value;
        modelInput.placeholder = opt().modelPlaceholder;
        baseUrlWrap.classList.toggle("hidden", !opt().needsBaseUrl);
        refresh();
      } }, providers.map((p) => h("option", { value: p.value, selected: p.value === st.provider }, p.label)))),
    h("div", null, h("label", { class: "label", for: "model" }, "Model"), modelInput,
      h("p", { class: "small muted", style: "margin-top:4px" }, "Sebaiknya model yang bisa membaca gambar. Model teks saja tetap bisa dipakai dengan data grafik manual atau database soal.")),
    baseUrlWrap,
    h("div", null, h("label", { class: "label", for: "apiKey" }, "API key"), keyInput),
    h("div", { class: "stack-sm" }, h("div", null, testBtn), testResult),
    warn, errBox, noticeBox, saveBtn,
  );
  baseUrlWrap.classList.toggle("hidden", !opt().needsBaseUrl);

  setChildren(root, h("div", { class: "stack-lg" }, active, form));
  refresh();
}

// ---------------------------------------------------------------- mulai halaman

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  const dataEl = document.getElementById("page-data");
  if (!root || !dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  window.PAGE = data;
  switch (root.dataset.page) {
    case "submission":
      taskFlow(root, data.detail);
      break;
    case "session":
      sessionFlow(root, data.view);
      break;
    case "questions":
      questionBank(root, data.questions);
      break;
    case "settings":
      settingsPage(root, data);
      break;
  }
});
