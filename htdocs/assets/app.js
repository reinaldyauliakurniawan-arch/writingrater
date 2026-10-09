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

const TASK_TITLES = { task1_academic: "Task 1 Academic", task2: "Task 2" };

/** Kriteria dengan band terendah (kosong kalau semua sama). */
function weakestKeys(criteria) {
  const bands = criteria.map((c) => c.band);
  const min = Math.min(...bands);
  return min === Math.max(...bands) ? [] : criteria.filter((c) => c.band === min).map((c) => c.key);
}

function formatDateId(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });
}

/** Ringkasan skor di atas halaman hasil: Overall besar + bar per kriteria. */
function scoreSummary(result, { meta = null, actions = null } = {}) {
  const weak = weakestKeys(result.criteria);
  return h("section", { class: "card score-hero" },
    h("div", { class: "score-overall" },
      h("p", { class: "small muted semibold" }, "Overall"),
      h("p", { class: "score-big" }, band1(result.task_band)),
      meta ? h("p", { class: "small muted" }, meta) : null),
    h("ul", { class: "score-bars", "aria-label": "Skor per kriteria" }, result.criteria.map((c) =>
      h("li", { class: weak.includes(c.key) ? "weak" : null },
        h("div", { class: "bar-label" },
          h("span", { class: "small semibold" }, c.name, weak.includes(c.key) ? h("span", { class: "focus-tag" }, "Fokus perbaikan") : null),
          h("span", { class: "bold" }, band1(c.band))),
        h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: `width:${(c.band / 9) * 100}%` }))))),
    actions ? h("div", { class: "row-sm score-actions" }, actions) : null);
}

function criteriaBlocks(criteria, weak = []) {
  return h("div", { class: "stack" }, criteria.map((c) =>
    h("section", { class: `criterion${weak.includes(c.key) ? " weak" : ""}` },
      h("div", { class: "criterion-head" },
        h("h3", null, c.name),
        h("span", { class: "band" }, band1(c.band))),
      weak.includes(c.key) ? h("p", { class: "focus-tag", style: "margin:4px 0 0" }, "Fokus perbaikan") : null,
      h("p", { class: "feedback" }, c.feedback),
      c.tip ? h("p", { class: "tip" }, h("span", { class: "semibold" }, "Tips: "), c.tip) : null,
    )));
}

function factErrorsBlock(result) {
  const facts = result.fact_errors ?? [];
  if (result.task_type !== "task1_academic" || facts.length === 0) return null;
  return h("details", { class: "card", open: true },
    h("summary", null, `Kesalahan data yang ditemukan (${facts.length})`),
    h("ul", { class: "stack-sm", style: "margin-top:12px" }, facts.map((f) =>
      h("li", { class: "fact-item" },
        h("p", { class: "italic" }, `“${f.essay_quote}”`),
        h("p", { style: "margin-top:4px" }, h("span", { class: "semibold" }, "Masalah: "), f.issue),
        h("p", { style: "margin-top:4px" }, h("span", { class: "semibold" }, "Data yang benar: "), f.correct_info),
      ))));
}

// ---------------------------------------------------------------- salin hasil (untuk Google Docs)

const MARK_BG = { content: "#ede9fe", data: "#fee2e2", cohesion: "#fce7f3", vocab: "#dbeafe", grammar: "#fef3c7" };
const COPY_PARTS = [
  ["prompt", "Soal"],
  ["scores", "Skor & feedback per kriteria"],
  ["facts", "Kesalahan data"],
  ["marks", "Koreksi pada tulisan"],
  ["polished", "Versi polished"],
  ["essay", "Jawaban asli"],
];
const COPY_DEFAULTS = { prompt: true, scores: true, facts: true, marks: true, polished: true, essay: false };

function loadCopyOpts() {
  try {
    return { ...COPY_DEFAULTS, ...JSON.parse(localStorage.getItem("copyOpts") ?? "{}") };
  } catch {
    return { ...COPY_DEFAULTS };
  }
}

function saveCopyOpts(o) {
  try {
    localStorage.setItem("copyOpts", JSON.stringify(o));
  } catch {
    /* penyimpanan browser tidak tersedia */
  }
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Teks (sudah di-escape) -> paragraf HTML. */
const htmlParas = (escaped) => escaped.trim().split(/\n\s*\n/).map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`).join("");

/** Bagian yang bisa ikut disalin untuk submission ini (bagian lain dinonaktifkan di pilihan). */
function copyAvailability(d) {
  const r = d.result;
  const p = d.polished;
  return {
    prompt: !!d.prompt_text.trim(),
    scores: true,
    facts: r.task_type === "task1_academic" && (r.fact_errors ?? []).length > 0,
    marks: !!p && p.mark_total > 0,
    polished: !!p,
    essay: !!d.essay_text.trim(),
  };
}

/** Laporan hasil dalam dua bentuk: HTML (tempel ke Google Docs tetap rapi) dan teks biasa. */
function buildReport(d, inc) {
  const r = d.result;
  const p = d.polished;
  const avail = copyAvailability(d);
  const on = (k) => inc[k] && avail[k];
  const H = [];
  const T = [];
  const title = `Hasil IELTS Writing ${TASK_TITLES[r.task_type]}`;
  H.push(`<h2>${escHtml(title)}</h2>`);
  T.push(title.toUpperCase());
  const meta = [
    d.student_name ? ["Murid", d.student_name] : null,
    ["Tanggal", formatDateId(d.graded_at ?? d.created_at)],
    ["Jumlah kata", `${r.word_count.counted} (minimal ${r.word_count.min})`],
    ["Skor Overall", band1(r.task_band)],
  ].filter(Boolean);
  H.push(`<p>${meta.map(([k, v]) => `<b>${escHtml(k)}:</b> ${escHtml(v)}`).join("<br>")}</p>`);
  T.push(meta.map(([k, v]) => `${k}: ${v}`).join("\n"));

  if (on("prompt")) {
    H.push(`<h3>Soal</h3>${htmlParas(escHtml(d.prompt_text))}`);
    T.push(`SOAL\n${d.prompt_text.trim()}`);
  }

  if (on("scores")) {
    const cell = "border:1px solid #d1d5db;padding:6px 10px";
    H.push(`<table style="border-collapse:collapse"><tbody>${r.criteria.map((c) =>
      `<tr><td style="${cell}">${escHtml(c.name)}</td><td style="${cell};text-align:center">${band1(c.band)}</td></tr>`).join("")}` +
      `<tr><td style="${cell}"><b>Overall</b></td><td style="${cell};text-align:center"><b>${band1(r.task_band)}</b></td></tr></tbody></table>`);
    T.push([...r.criteria.map((c) => `${c.name}: ${band1(c.band)}`), `Overall: ${band1(r.task_band)}`].join("\n"));
    for (const c of r.criteria) {
      H.push(`<h3>${escHtml(c.name)}: ${band1(c.band)}</h3><p>${escHtml(c.feedback)}</p>` + (c.tip ? `<p><i><b>Tips:</b> ${escHtml(c.tip)}</i></p>` : ""));
      T.push(`${c.name.toUpperCase()}: ${band1(c.band)}\n${c.feedback}` + (c.tip ? `\nTips: ${c.tip}` : ""));
    }
  }

  if (on("facts")) {
    const facts = r.fact_errors;
    H.push(`<h3>Kesalahan data (${facts.length})</h3><ol>${facts.map((f) =>
      `<li><i>“${escHtml(f.essay_quote)}”</i><br><b>Masalah:</b> ${escHtml(f.issue)}<br><b>Data yang benar:</b> ${escHtml(f.correct_info)}</li>`).join("")}</ol>`);
    T.push(`KESALAHAN DATA\n${facts.map((f, i) => `${i + 1}. “${f.essay_quote}”\n   Masalah: ${f.issue}\n   Data yang benar: ${f.correct_info}`).join("\n")}`);
  }

  if (on("marks")) {
    let n = 0;
    const list = [];
    let hBody = "";
    let tBody = "";
    for (const s of p.original_segments) {
      if (!s.mark) {
        hBody += escHtml(s.text);
        tBody += s.text;
        continue;
      }
      n++;
      list.push(s);
      hBody += `<span style="background-color:${MARK_BG[s.mark.type]}">${escHtml(s.text)}</span><sup><b>[${n}]</b></sup>`;
      tBody += `${s.text} [${n}]`;
    }
    const legend = Object.entries(MARK_TYPES).filter(([t]) => p.mark_counts[t] > 0)
      .map(([t, name]) => `<span style="background-color:${MARK_BG[t]}">&nbsp;${escHtml(name)}&nbsp;</span>`).join(" ");
    H.push(`<h3>Koreksi pada tulisan</h3><p>${legend}</p>${htmlParas(hBody)}<ol>${list.map((s) =>
      `<li><b>${escHtml(MARK_TYPES[s.mark.type])}:</b> “${escHtml(s.text)}” → <b>${escHtml(s.mark.correction)}</b><br>${escHtml(s.mark.issue)}</li>`).join("")}</ol>`);
    T.push(`KOREKSI PADA TULISAN\n${tBody.trim()}\n\n${list.map((s, i) => `[${i + 1}] ${MARK_TYPES[s.mark.type]}: “${s.text}” → ${s.mark.correction}\n    ${s.mark.issue}`).join("\n")}`);
  }

  if (on("polished")) {
    const head = `Versi polished (target band ${band1(p.target_band)}, skor ulang ${band1(p.rescored_task_band)})`;
    H.push(`<h3>${escHtml(head)}</h3>${htmlParas(escHtml(p.polished_text))}`);
    T.push(`${head.toUpperCase()}\n${p.polished_text.trim()}`);
  }

  if (on("essay")) {
    H.push(`<h3>Jawaban asli</h3>${htmlParas(escHtml(d.essay_text))}`);
    T.push(`JAWABAN ASLI\n${d.essay_text.trim()}`);
  }

  const note = "Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS.";
  H.push(`<p style="color:#6b7280"><i>${note}</i></p>`);
  T.push(note);
  return { html: H.join(""), text: T.join("\n\n") };
}

/** Salin HTML + teks biasa. Cadangan untuk browser tanpa ClipboardItem: salin dari elemen tersembunyi. */
async function copyRich(html, text) {
  if (window.ClipboardItem && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return true;
    } catch {
      /* lanjut ke cara lama */
    }
  }
  const box = h("div", { contenteditable: "true", style: "position:fixed;left:-9999px;top:0;width:600px" });
  box.innerHTML = html;
  document.body.append(box);
  const sel = getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  sel.removeAllRanges();
  box.remove();
  return ok;
}

/** Panel pilihan "Salin untuk murid". onPolish (opsional) = buat versi polished dulu. */
function copyPanel(d, { onClose, onPolish = null }) {
  const opts = loadCopyOpts();
  const avail = copyAvailability(d);
  const status = h("p", { class: "small", role: "status" });
  const box = h("section", { class: "card stack-sm copy-panel" });
  const draw = () => setChildren(box,
    h("div", { class: "row", style: "justify-content:space-between" },
      h("h2", { class: "section-title", style: "margin:0" }, "Salin untuk murid"),
      h("button", { type: "button", class: "link-btn", onclick: onClose }, "Tutup")),
    h("p", { class: "small muted" }, "Pilih isi yang mau disalin, lalu tempel (Ctrl+V) di Google Docs, email, atau chat. Format judul, tebal, dan warna ikut terbawa."),
    h("div", { class: "copy-options" }, COPY_PARTS.map(([k, label]) =>
      h("label", { class: `check${avail[k] ? "" : " off"}` },
        h("input", { type: "checkbox", checked: avail[k] && opts[k], disabled: !avail[k], onchange: (e) => {
          opts[k] = e.target.checked;
          saveCopyOpts(opts);
        } }),
        label))),
    !d.polished && onPolish
      ? h("p", { class: "small muted" }, "Koreksi pada tulisan dan versi polished bisa ikut disalin setelah dibuat. ",
          h("button", { type: "button", class: "link-btn", onclick: onPolish }, "Buat sekarang"))
      : null,
    h("div", { class: "row-sm" },
      h("button", { type: "button", class: "btn-primary", onclick: async () => {
        const { html, text } = buildReport(d, opts);
        const ok = await copyRich(html, text);
        status.className = ok ? "small notice" : "small text-danger";
        status.textContent = ok ? "Tersalin. Tinggal tempel (Ctrl+V) di Google Docs." : "Browser menolak menyalin. Coba lagi.";
      } }, "Salin"),
      status));
  draw();
  return box;
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
    h("h2", { style: "font-size:20px;font-weight:700" }, "Koreksi & versi polished — target band ", h("span", { class: "badge-accent" }, band1(p.target_band))),
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

// ---------------------------------------------------------------- progres aksi AI

const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Satu timer untuk semua penghitung waktu di halaman.
setInterval(() => {
  document.querySelectorAll("[data-since]").forEach((el) => (el.textContent = fmtElapsed(Date.now() - Number(el.dataset.since))));
}, 1000);

/** progress = { stages: [label], index, since, hint } */
function progressView(progress) {
  if (!progress) return null;
  return h("div", { class: "progress-box", role: "status", "aria-live": "polite" },
    h("ol", { class: "progress-steps" }, progress.stages.map((label, i) =>
      h("li", { class: i < progress.index ? "done" : i === progress.index ? "current" : "todo" },
        h("span", { class: "progress-icon", "aria-hidden": "true" }, i < progress.index ? "✓" : ""),
        label))),
    h("p", { class: "small muted" },
      h("span", { class: "semibold", "data-since": String(progress.since) }, fmtElapsed(Date.now() - progress.since)),
      ` · ${progress.hint} Jangan tutup halaman ini.`));
}

// ---------------------------------------------------------------- alur latihan (TaskFlow)

const AUTOSAVE_MS = 2000;

/** Hasil baca grafik perlu dicek manusia: dua pembacaan berbeda (sel kuning) atau bentuk tabel tidak sama. */
const needsDataReview = (d) => {
  const u = d.extraction_uncertain;
  return !!u && (!Array.isArray(u) || u.length > 0);
};

/**
 * Satu latihan (Task 1 / Task 2): soal + jawaban di satu layar, lalu hasil.
 * opts.onChange(detail) dipanggil setiap detail berubah; opts.afterResult() mengembalikan elemen tambahan di bawah hasil.
 */
function taskFlow(root, initial, opts = {}) {
  const minWords = window.PAGE?.minWords ?? { task1_academic: 150, task2: 250 };
  const students = window.PAGE?.students ?? [];
  const s = {
    detail: initial,
    promptText: initial.prompt_text,
    essay: initial.essay_text,
    studentName: initial.student_name ?? "",
    busy: null,
    progress: null,
    editingData: false, // layar cek/isi data grafik (Task 1)
    manual: false,
    gradeAfterData: false, // lanjut menilai setelah data grafik dicek
    draft: null, // salinan data grafik yang sedang diedit
    showPolished: !!initial.polished,
    showCopy: false,
    error: null,
  };
  let autosaveTimer = null;
  let lastSavedEssay = initial.essay_text;
  let questionList = null; // daftar soal dimuat sekali per halaman

  const isTask1 = () => s.detail.task_type === "task1_academic";
  function step() {
    if (s.detail.status === "graded") return "result";
    return isTask1() && s.editingData ? "data" : "write";
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

  /** Mulai daftar tahap progres; advance() menandai tahap berjalan selesai. */
  function startProgress(stages, hint) {
    s.progress = { stages, index: 0, since: Date.now(), hint };
    render();
  }
  function advance() {
    if (!s.progress) return;
    s.progress.index = Math.min(s.progress.index + 1, s.progress.stages.length - 1);
    render();
  }

  const onExtract = () => {
    if (!s.detail.prompt_image_url) return set({ error: "Unggah gambar grafik dulu." });
    action("extract", async () => {
      try {
        if (s.promptText !== s.detail.prompt_text) setDetail(await savePrompt());
        startProgress(["Membaca grafik"], "Biasanya 10–40 detik.");
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
      s.gradeAfterData = false;
      s.editingData = true;
      s.draft = null;
    });
  };

  const openData = () => set({ editingData: true, manual: false, gradeAfterData: false, draft: null, error: null });

  async function runGrade() {
    const t1 = isTask1();
    const stages = t1 ? ["Mengecek angka di jawaban", "Menilai 4 kriteria"] : ["Menilai 4 kriteria"];
    if (s.progress) {
      s.progress.stages = [...s.progress.stages.slice(0, s.progress.index + 1), ...stages];
      advance();
    } else {
      startProgress(stages, "Biasanya 15–40 detik per tahap.");
    }
    const r = await apiSteps(`/api/submissions/${s.detail.id}/grade`, { essay_text: s.essay }, advance);
    lastSavedEssay = s.essay;
    setDetail({ ...s.detail, essay_text: s.essay, status: "graded", result: r.result, last_error_code: null, graded_at: new Date().toISOString() });
  }

  const onGrade = () => {
    const d = s.detail;
    if (!s.promptText.trim() && !d.prompt_image_url) return set({ error: "Isi soal dulu (teks atau gambar)." });
    if (isTask1() && !d.prompt_image_url && d.status !== "confirmed") {
      return set({ error: "Task 1 butuh gambar grafik. Kalau tidak ada gambar, isi data grafik manual." });
    }
    if (!s.essay.trim()) return set({ error: "Jawaban masih kosong." });
    action("grade", async () => {
      clearTimeout(autosaveTimer);
      if (s.promptText !== s.detail.prompt_text) setDetail(await savePrompt());
      if (isTask1() && s.detail.status !== "confirmed") {
        if (s.detail.status === "draft") {
          startProgress(["Membaca grafik"], "Biasanya 15–40 detik per tahap.");
          try {
            await api(`/api/submissions/${s.detail.id}/extract`, { method: "POST", json: {} });
          } finally {
            await reload().catch(() => {});
          }
        }
        if (needsDataReview(s.detail)) {
          // Berhenti: tutor/murid cek angka yang ragu dulu, lalu penilaian dilanjutkan dari layar data.
          s.editingData = true;
          s.manual = false;
          s.gradeAfterData = true;
          s.draft = null;
          return;
        }
        const data = s.detail.extracted_data;
        await api(`/api/submissions/${s.detail.id}/extracted-data`, { method: "PUT", json: { extracted_data: data } });
        setDetail({ ...s.detail, status: "confirmed" });
      }
      await runGrade();
    });
  };

  const onConfirmData = (data) =>
    action(s.gradeAfterData ? "grade" : "confirm", async () => {
      await api(`/api/submissions/${s.detail.id}/extracted-data`, { method: "PUT", json: { extracted_data: data } });
      const gradeNow = s.gradeAfterData && s.essay.trim() !== "";
      Object.assign(s, { manual: false, draft: null, editingData: false, gradeAfterData: false });
      setDetail({ ...s.detail, extracted_data: data, extraction_uncertain: null, status: "confirmed" });
      if (gradeNow) await runGrade();
    });

  const scrollToPolished = () => root.querySelector(".polished-section")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const onPolish = () => {
    if (s.detail.polished) {
      set({ showPolished: true });
      return scrollToPolished();
    }
    action("polish", async () => {
      const t1 = isTask1();
      const round = (n) => [n === 1 ? "Menulis versi polished" : "Menulis ulang (percobaan ke-2)", ...(t1 ? ["Mengecek angka"] : []), "Menilai ulang versi polished"];
      startProgress(round(1), "Biasanya 30–60 detik per tahap.");
      const r = await apiSteps(`/api/submissions/${s.detail.id}/polish`, {}, (msg) => {
        if (/menulis ulang/i.test(msg ?? "") && s.progress.stages.length < 8) s.progress.stages.push(...round(2));
        advance();
      });
      setDetail({ ...s.detail, polished: r.polished });
      s.showPolished = true;
    }).then(() => s.detail.polished && scrollToPolished());
  };

  const onRevise = () =>
    action("revise", async () => {
      const { id } = await api(`/api/submissions/${s.detail.id}/revise`, { method: "POST", json: {} });
      location.href = `/submissions/${id}`;
      await new Promise(() => {}); // tetap "sibuk" sampai halaman berpindah
    });

  // ---- nama murid (boleh diubah kapan saja)
  function studentField() {
    const status = h("span", { class: "small muted", role: "status" });
    const listId = `students-${s.detail.id}`;
    const save = async (e) => {
      const name = e.target.value.replace(/\s+/g, " ").trim();
      if (name === (s.detail.student_name ?? "")) return;
      status.textContent = "Menyimpan…";
      try {
        const d = await api(`/api/submissions/${s.detail.id}`, { method: "PATCH", json: { student_name: name } });
        s.studentName = d.student_name ?? "";
        setDetail({ ...s.detail, student_name: d.student_name });
        status.textContent = "Tersimpan";
      } catch (err) {
        status.textContent = errorMessage(err);
      }
    };
    return h("div", { class: "student-field" },
      h("label", { class: "small semibold", for: `student-${s.detail.id}` }, "Nama murid"),
      h("input", { id: `student-${s.detail.id}`, class: "input", list: listId, maxlength: "100", autocomplete: "off",
        placeholder: "Opsional, mis. Rina", value: s.studentName,
        oninput: (e) => (s.studentName = e.target.value), onchange: save,
        onkeydown: (e) => e.key === "Enter" && e.target.blur() }),
      h("datalist", { id: listId }, students.map((n) => h("option", { value: n }))),
      status);
  }

  // ---- soal dari database
  function questionPicker() {
    const box = h("div", { class: "picker" }, h("p", { class: "muted small" }, "Memuat database soal…"));
    questionList ??= api(`/api/questions?task_type=${s.detail.task_type}`);
    questionList.then((list) => {
      let selected = "";
      let err = null;
      const draw = () => {
        const select = h("select", { class: "input grow", "aria-label": "Soal dari database", disabled: s.busy !== null, onchange: (e) => {
          selected = e.target.value;
          useBtn.disabled = !selected || s.busy !== null;
        } }, h("option", { value: "" }, list.length ? "— Pilih soal dari database —" : "Database soal masih kosong"), list.map((q) => h("option", { value: q.id }, q.name)));
        const useBtn = h("button", { type: "button", class: "btn-secondary", disabled: true, onclick: async () => {
          useBtn.disabled = true;
          useBtn.textContent = "Memuat…";
          try {
            const d = await api(`/api/submissions/${s.detail.id}/use-question`, { method: "POST", json: { question_id: selected } });
            setDetail(d);
            s.promptText = d.prompt_text;
            set({ error: null });
          } catch (e) {
            err = errorMessage(e);
            draw();
          }
        } }, "Pakai");
        setChildren(box,
          h("div", { class: "row-sm" }, select, useBtn),
          errorBanner(err));
      };
      draw();
    }).catch(() => {
      questionList = null;
      box.remove();
    });
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
      return h("div", { class: "stack-sm" },
        h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img" }),
        h("div", { class: "row-sm" },
          h("button", { type: "button", class: "link-btn", disabled: s.busy !== null, onclick: () => fileInput.click() }, "Ganti gambar"),
          h("button", { type: "button", class: "link-btn danger", disabled: s.busy !== null, onclick: () =>
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
      h("span", { class: "semibold text-primary" }, s.busy === "upload" ? "Mengunggah…" : isTask1() ? "Pilih gambar grafik" : "Pilih gambar soal"),
      h("span", { class: "small muted", style: "margin-top:4px" }, "Klik, seret file ke sini, atau tempel (Ctrl+V). PNG, JPG, WEBP, maks. 5 MB."));
    return h("div", null, zone, fileInput);
  }

  /** Keterangan data grafik di kolom soal (Task 1). */
  function dataNote() {
    const d = s.detail;
    const disabled = s.busy !== null;
    if (d.status === "confirmed") {
      return h("p", { class: "data-note ok small" }, "✓ Data grafik siap dipakai untuk mengecek angka. ",
        h("button", { type: "button", class: "link-btn", disabled, onclick: openData }, "Lihat / ubah data"));
    }
    if (d.status === "extracted") {
      return h("p", { class: "data-note small" }, "Grafik sudah dibaca. ",
        h("button", { type: "button", class: "link-btn", disabled, onclick: openData }, "Cek data"));
    }
    return h("p", { class: "data-note small muted" },
      d.prompt_image_url ? "Angka di grafik dibaca otomatis saat jawaban dinilai. " : "Tidak punya gambar? ",
      h("button", { type: "button", class: "link-btn", disabled, onclick: onManual }, "Isi data grafik manual"));
  }

  // ---- layar tulis: soal (kiri) + jawaban (kanan)
  function writeStep() {
    const d = s.detail;
    const t1 = isTask1();
    const min = minWords[d.task_type];
    const grading = s.busy === "grade";
    const locked = s.busy !== null;
    const counter = h("p", { class: "small" });
    const saveState = h("p", { class: "small muted" });
    const updateCount = () => {
      const wc = countWords(s.essay, s.promptText);
      counter.className = wc.counted < min ? "small wordcount-low" : "small muted";
      counter.textContent = `${wc.counted} kata / minimal ${min}` + (wc.excluded > 0 ? ` (${wc.excluded} kata salinan soal tidak dihitung)` : "");
    };
    const textarea = h("textarea", { id: "essay", class: "input essay", maxlength: "10000",
      placeholder: "Tulis atau tempel jawaban di sini (bahasa Inggris).",
      value: s.essay, disabled: locked, oninput: (e) => {
        s.essay = e.target.value;
        updateCount();
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(async () => {
          if (s.essay === lastSavedEssay || s.busy !== null) return;
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

    const promptCol = h("section", { class: "card stack col-prompt" },
      h("div", { class: "row", style: "justify-content:space-between;gap:8px" },
        h("h2", { class: "section-title", style: "margin:0" }, "Soal"),
        d.question ? h("span", { class: "chip" }, d.question.name) : null),
      questionPicker(),
      h("div", null,
        h("label", { class: "label label-sm", for: "prompt" }, "Teks soal"),
        h("textarea", { id: "prompt", class: "input", style: "min-height:110px", maxlength: "5000", placeholder: "Tempel teks soal di sini.",
          value: s.promptText, disabled: locked,
          oninput: (e) => {
            s.promptText = e.target.value;
            updateCount();
          },
          onchange: async () => {
            if (s.busy !== null || s.promptText === s.detail.prompt_text) return;
            try {
              setDetail(await savePrompt());
            } catch {
              /* disimpan lagi saat dinilai */
            }
          } })),
      h("div", null,
        h("p", { class: "label label-sm" }, t1 ? "Gambar grafik" : "Gambar soal (opsional)"),
        imageInput()),
      t1 ? dataNote() : null);

    const answerCol = h("section", { class: "stack-sm col-answer" },
      h("label", { class: "section-title", for: "essay", style: "display:block;margin:0" }, "Jawaban"),
      textarea,
      h("div", { class: "row", style: "justify-content:space-between;gap:8px" }, counter, saveState),
      errorBanner(s.error),
      grading ? progressView(s.progress) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn-primary btn-lg", disabled: locked, onclick: onGrade }, grading ? "Sedang menilai…" : "Nilai jawaban")));

    return h("div", { class: "write-grid" }, promptCol, answerCol);
  }

  // ---- layar cek / isi data grafik (Task 1)
  function dataStep() {
    const d = s.detail;
    s.draft ??= clone(d.extracted_data ?? emptyExtractedData());
    const data = s.draft;
    const manual = s.manual;
    const u = d.extraction_uncertain;
    const mismatch = u && !Array.isArray(u);
    const nUncertain = Array.isArray(u) ? u.length : 0;
    const locked = s.busy !== null;
    const intro = manual
      ? "Ketik data dari grafik: judul kolom (mis. tahun), label baris, dan angkanya. Data ini dipakai untuk mengecek ketepatan angka di jawaban."
      : mismatch
        ? "Dua kali pembacaan grafik memberi hasil yang berbeda bentuk. Cek semua angka dengan gambar, lalu perbaiki yang salah."
        : nUncertain > 0
          ? `AI ragu membaca ${nUncertain} angka (kotak kuning). Cukup cek angka itu dengan gambar dan perbaiki kalau salah.`
          : "Data ini dipakai untuk mengecek ketepatan angka di jawaban. Ubah kalau ada yang salah.";
    return h("div", { class: "stack" },
      h("div", null,
        h("h2", { class: "section-title", style: "margin-bottom:4px" }, manual ? "Isi data grafik" : "Cek data grafik"),
        h("p", { class: mismatch || nUncertain ? "banner-warning" : "small muted" }, intro)),
      h("div", { class: "grid-2 data-grid" },
        h("div", { class: "stack-sm" },
          d.prompt_image_url ? h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img-lg" }) : null,
          !d.prompt_image_url && d.prompt_text ? h("p", { class: "card prewrap small" }, d.prompt_text) : null),
        extractionEditor(data, { uncertain: d.extraction_uncertain, disabled: locked })),
      errorBanner(s.error),
      s.busy === "grade" || s.busy === "extract" ? progressView(s.progress) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn-secondary", disabled: locked, onclick: () => set({ editingData: false, manual: false, gradeAfterData: false, draft: null, error: null }) }, "Kembali"),
        !manual && d.prompt_image_url ? h("button", { type: "button", class: "btn-secondary", disabled: locked, onclick: onExtract }, "Baca ulang grafik") : null,
        h("button", { type: "button", class: "btn-primary", disabled: locked, onclick: () => onConfirmData(data) },
          s.gradeAfterData && s.essay.trim() ? "Data sudah benar, nilai jawaban" : "Simpan data")),
    );
  }

  // ---- simpan ke database soal
  function saveQuestion() {
    const d = s.detail;
    if (d.question) return null;
    let err = null;
    const box = h("details", { class: "card" });
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
      h("summary", null, "Simpan soal ini ke database soal"),
      h("div", { class: "stack-sm", style: "margin-top:12px" },
        h("p", { class: "small muted" }, `Tutor dan murid lain bisa memakai soal ini tanpa perlu ${isTask1() ? "membaca grafik" : "mengetik soal"} ulang.`),
        h("div", { class: "row-sm" }, nameInput, btn),
        errorBanner(err)));
    draw();
    return box;
  }

  // ---- hasil
  function resultStep() {
    const d = s.detail;
    const r = d.result;
    const locked = s.busy !== null;
    const weak = weakestKeys(r.criteria);
    const canPolish = r.polish_target !== null;
    const meta = [`${r.word_count.counted} kata`, formatDateId(d.graded_at ?? d.created_at)].filter(Boolean).join(" · ");
    const actions = [
      h("button", { type: "button", class: "btn-primary", disabled: locked, onclick: () => set({ showCopy: !s.showCopy }) }, "Salin untuk murid"),
      canPolish
        ? h("button", { type: "button", class: "btn-secondary", disabled: locked, onclick: onPolish }, d.polished ? "Lihat koreksi & versi polished" : "Buat koreksi & versi polished")
        : null,
      h("button", { type: "button", class: "btn-secondary", disabled: locked, onclick: onRevise }, "Revisi & nilai ulang"),
    ];
    const essayCard = h("section", { class: "card stack-sm col-essay" },
      h("h2", { class: "section-title", style: "margin:0" }, "Jawaban"),
      h("details", null,
        h("summary", { class: "small" }, "Soal", d.question ? h("span", { class: "muted", style: "font-weight:400" }, ` · ${d.question.name}`) : null),
        h("div", { class: "stack-sm", style: "margin-top:8px" },
          d.prompt_text ? h("p", { class: "prewrap small" }, d.prompt_text) : null,
          d.prompt_image_url ? h("img", { src: d.prompt_image_url, alt: "Gambar soal", class: "prompt-img", style: "max-height:280px" }) : null)),
      h("div", { class: "essay-text" }, d.essay_text));
    return h("div", { class: "stack-lg" },
      scoreSummary(r, { meta, actions }),
      errorBanner(s.error),
      s.busy === "polish" ? progressView(s.progress) : null,
      s.showCopy ? copyPanel(d, { onClose: () => set({ showCopy: false }), onPolish: canPolish && !d.polished ? onPolish : null }) : null,
      h("div", { class: "result-grid" },
        h("div", { class: "stack" },
          criteriaBlocks(r.criteria, weak),
          factErrorsBlock(r),
          h("p", { class: "small muted" }, "Skor ini adalah estimasi berbasis AI untuk latihan, bukan skor resmi IELTS.")),
        essayCard),
      s.showPolished && d.polished ? polishedPanel(d.polished) : null,
      opts.afterResult?.() ?? null,
    );
  }

  function render() {
    const current = step();
    setChildren(root, h("div", { class: "stack-lg" },
      h("div", { class: "flow-head" },
        h("h1", { class: "page-title" }, TASK_TITLES[s.detail.task_type]),
        studentField()),
      current === "write" ? writeStep() : null,
      current === "data" ? dataStep() : null,
      current === "result" && s.detail.result ? resultStep() : null,
      current === "result" || (current === "write" && (isTask1() ? s.detail.status === "confirmed" : !!(s.detail.prompt_text.trim() || s.detail.prompt_image_url)))
        ? saveQuestion()
        : null,
    ));
  }

  // Tempel gambar dari clipboard di layar tulis.
  const onPaste = (e) => {
    if (step() !== "write" || s.busy !== null || !root.isConnected) return;
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
    keyInfo.textContent = describeKey();
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
  // Pemilih model: ambil daftar model yang tersedia untuk key ini dari provider.
  const modelList = h("div", { class: "stack-sm hidden", style: "margin-top:8px" });
  const fetchModelsBtn = h("button", { type: "button", class: "link-btn", onclick: async () => {
    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = "Mengambil…";
    try {
      const { models } = await api("/api/settings/models", { method: "POST", json: body() });
      const select = h("select", { class: "input", "aria-label": "Pilih model", onchange: (e) => {
        if (!e.target.value) return;
        st.model = e.target.value;
        modelInput.value = st.model;
        refresh();
      } },
        h("option", { value: "" }, `— Pilih dari ${models.length} model yang tersedia —`),
        models.map((m) => h("option", { value: m, selected: m === st.model }, m)));
      setChildren(modelList, select, h("p", { class: "small muted" }, "Setelah memilih, klik Tes koneksi. Model yang tercantum belum tentu aktif atau cepat; hasil tes yang menentukan."));
    } catch (e) {
      setChildren(modelList, h("p", { class: "banner-error" }, errorMessage(e)));
    }
    modelList.classList.remove("hidden");
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = "Ambil daftar model";
  } }, "Ambil daftar model");
  // Bukan type="password": Chrome mengisi kolom password dengan password login tersimpan, sehingga
  // password login terkirim sebagai API key (HTTP 401). Teks disamarkan lewat CSS.
  const keyInput = h("input", { id: "apiKey", type: "text", name: "llm-provider-key", autocomplete: "off", spellcheck: "false",
    "data-lpignore": "true", "data-1p-ignore": "true", class: "input secret", value: "",
    placeholder: saved.has_api_key && saved.api_key_last4 ? `•••• ${saved.api_key_last4} (kosongkan untuk tetap memakai key ini)` : "",
    oninput: (e) => { st.apiKey = e.target.value; refresh(); } });
  const keyInfo = h("p", { class: "small muted", style: "margin-top:4px" });
  const keyToggle = h("button", { type: "button", class: "link-btn", onclick: () => {
    keyInput.classList.toggle("secret");
    keyToggle.textContent = keyInput.classList.contains("secret") ? "Tampilkan" : "Sembunyikan";
  } }, "Tampilkan");
  const describeKey = () => {
    const k = st.apiKey.trim();
    if (k) return `Akan memakai key baru: ${k.slice(0, 6)}…${k.slice(-4)} (${k.length} karakter).`;
    return saved.has_api_key && saved.api_key_last4 ? `Memakai key tersimpan yang berakhiran ${saved.api_key_last4}.` : "Belum ada key tersimpan.";
  };

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
        modelList.classList.add("hidden"); // daftar lama milik provider lain
        refresh();
      } }, providers.map((p) => h("option", { value: p.value, selected: p.value === st.provider }, p.label)))),
    h("div", null,
      h("div", { class: "row", style: "justify-content:space-between" }, h("label", { class: "label", for: "model" }, "Model"), fetchModelsBtn),
      modelInput, modelList,
      h("p", { class: "small muted", style: "margin-top:4px" }, "Sebaiknya model yang bisa membaca gambar. Model teks saja tetap bisa dipakai dengan data grafik manual atau database soal.")),
    baseUrlWrap,
    h("div", null,
      h("div", { class: "row", style: "justify-content:space-between" }, h("label", { class: "label", for: "apiKey" }, "API key"), keyToggle),
      keyInput, keyInfo),
    h("div", { class: "stack-sm" }, h("div", null, testBtn), testResult),
    warn, errBox, noticeBox, saveBtn,
  );
  baseUrlWrap.classList.toggle("hidden", !opt().needsBaseUrl);

  setChildren(root, h("div", { class: "stack-lg" }, active, form));
  refresh();
}

// ---------------------------------------------------------------- grafik progres (Riwayat)

const SERIES = [
  ["task1_academic", "Task 1", "#00936f"],
  ["task2", "Task 2", "#6d4fd8"],
];

/** Garis skor per task dari waktu ke waktu. points: [{ task, band, at, label, student }] urut waktu. */
function historyChart(root, points) {
  const series = SERIES.filter(([k]) => points.some((p) => p.task === k));
  const tip = h("div", { class: "chart-tip hidden", role: "tooltip" });
  const svgWrap = h("div", { class: "chart-wrap" });
  const table = h("details", { class: "small", style: "margin-top:8px" },
    h("summary", null, "Lihat sebagai tabel"),
    h("div", { class: "data-table-wrap", style: "margin-top:8px" },
      h("table", { class: "data-table" },
        h("thead", null, h("tr", null, h("th", null, "Tanggal"), h("th", null, "Murid"), h("th", null, "Task"), h("th", null, "Skor"))),
        h("tbody", null, [...points].reverse().map((p) =>
          h("tr", null, h("td", null, p.label), h("td", null, p.student ?? "–"), h("td", null, TASK_TITLES[p.task]), h("td", null, band1(p.band))))))));
  setChildren(root,
    series.length > 1
      ? h("ul", { class: "chart-legend small" }, series.map(([, name, color]) =>
          h("li", null, h("span", { class: "legend-line", style: `background:${color}` }), name)))
      : null,
    svgWrap, tip, table);

  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  function draw() {
    const W = Math.max(280, svgWrap.clientWidth);
    const H = 220;
    const m = { top: 12, right: 40, bottom: 28, left: 32 };
    const minBand = Math.min(...points.map((p) => p.band));
    const lo = Math.max(0, Math.floor(minBand) - 1);
    const hi = 9;
    const n = points.length;
    const x = (i) => m.left + (n === 1 ? (W - m.left - m.right) / 2 : (i / (n - 1)) * (W - m.left - m.right));
    const y = (b) => m.top + ((hi - b) / (hi - lo)) * (H - m.top - m.bottom);
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Grafik progres skor" });
    for (let b = lo; b <= hi; b++) {
      svg.append(el("line", { x1: m.left, x2: W - m.right, y1: y(b), y2: y(b), stroke: "#eef0f2", "stroke-width": 1 }));
      const t = el("text", { x: m.left - 8, y: y(b) + 4, "text-anchor": "end", class: "chart-axis" });
      t.textContent = b;
      svg.append(t);
    }
    // Tanggal pertama & terakhir di sumbu bawah.
    [[0, "start"], [n - 1, "end"]].forEach(([i, anchor], k) => {
      if (k === 1 && n === 1) return;
      const t = el("text", { x: x(i), y: H - 6, "text-anchor": n === 1 ? "middle" : anchor, class: "chart-axis" });
      t.textContent = points[i].label.replace(/ \d{2}\.\d{2}$/, "");
      svg.append(t);
    });
    for (const [key, name, color] of series) {
      const idx = points.map((p, i) => [p, i]).filter(([p]) => p.task === key);
      if (idx.length > 1) {
        svg.append(el("polyline", { points: idx.map(([p, i]) => `${x(i)},${y(p.band)}`).join(" "), fill: "none", stroke: color,
          "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      }
      for (const [p, i] of idx) {
        const dot = el("circle", { cx: x(i), cy: y(p.band), r: 4.5, fill: color, stroke: "#fff", "stroke-width": 2 });
        const hit = el("circle", { cx: x(i), cy: y(p.band), r: 12, fill: "transparent", tabindex: 0, class: "chart-hit" });
        const show = () => {
          setChildren(tip, h("strong", null, `${name}: ${band1(p.band)}`), h("br"), p.label, p.student ? [h("br"), p.student] : null);
          tip.classList.remove("hidden");
          const left = Math.min(Math.max(x(i) - 75, 0), W - 150);
          tip.style.left = `${svgWrap.offsetLeft + left}px`;
          tip.style.top = `${svgWrap.offsetTop + y(p.band) - tip.offsetHeight - 12}px`;
        };
        hit.addEventListener("mouseenter", show);
        hit.addEventListener("focus", show);
        hit.addEventListener("mouseleave", () => tip.classList.add("hidden"));
        hit.addEventListener("blur", () => tip.classList.add("hidden"));
        svg.append(dot, hit);
      }
      // Label nilai terakhir hanya kalau titiknya di ujung kanan (tidak menimpa garis lain).
      const [last, li] = idx[idx.length - 1];
      if (li === n - 1) {
        const t = el("text", { x: x(li) + 10, y: y(last.band) + 4, class: "chart-label" });
        t.textContent = band1(last.band);
        svg.append(t);
      }
    }
    svgWrap.replaceChildren(svg);
  }
  draw();
  let timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  });
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
    case "history":
      historyChart(root, data.points);
      break;
    case "questions":
      questionBank(root, data.questions);
      break;
    case "settings":
      settingsPage(root, data);
      break;
  }
});
