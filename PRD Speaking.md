# PRD — Fitur IELTS Speaking

Status: disepakati 2026-11-06. Fitur Writing tidak berubah.

## 1. Tujuan

Examiner menjalankan simulasi IELTS Speaking untuk murid langsung di web. Rekaman suara diubah jadi teks **di browser examiner** (tanpa dikirim ke mana pun). AI hanya membaca transkrip untuk memberi usulan skor Lexical Resource (LR) dan Grammatical Range & Accuracy (GRA). Examiner menilai Fluency & Coherence (FC) dan Pronunciation (P), boleh mengubah usulan AI, lalu menekan **Finalize**. Nilai yang difinalisasi itulah nilai resmi laporan.

## 2. Keputusan terkunci

| Hal | Keputusan |
|---|---|
| Siapa yang menjalankan | Examiner, di perangkatnya sendiri. Murid membaca soal di layar lalu menjawab dengan kata-kata sendiri. |
| Transkripsi | Whisper (open source, lisensi MIT) lewat transformers.js (Apache 2.0) di browser. Model `onnx-community/whisper-base.en` (minimal "base", bukan "tiny"). Gratis, tanpa API key. |
| Audio | **Tidak pernah diunggah, tidak disimpan.** Dibuang setelah ditranskripsi. Server hanya menerima teks. |
| Mode | Part 1 saja, Part 2 saja, Part 3 saja, atau Lengkap (Part 1–3). |
| Timer | Tidak ada hitung mundur. Hanya durasi rekaman yang tampil. |
| Rekaman | Satu rekaman per Part. Examiner klik Mulai/Selesai. Bisa rekam ulang Part sebelum dinilai. |
| Pembagian nilai | AI: usulan LR + GRA. Examiner: FC + P (wajib), dan boleh mengubah LR/GRA. Semua skor kriteria bilangan bulat 0–9. |
| Skor keseluruhan | Rata-rata 4 kriteria, dibulatkan ke 0,5 terdekat (aturan pembulatan sama dengan Writing). |
| Label | Mode Lengkap = "Skor simulasi". Mode satu Part = "Estimasi latihan". |
| Finalize | Setelah Finalize hasil terkunci; ada tombol **Buka kembali** untuk mengedit lalu Finalize lagi. Waktu finalisasi terakhir dicatat. |
| Komentar | Satu kolom "Examiner's comment" opsional. Kosong = tidak ditampilkan. |
| Perangkat | Tidak memblokir jenis perangkat. Yang menentukan adalah lolos/tidaknya Cek Perangkat. Disclaimer: "Gunakan komputer atau laptop yang memadai dengan mikrofon untuk pengalaman terbaik." HP/tablet hanya diberi peringatan lunak. |
| Bank soal | 30 set dari `books/Speaking from the books.docx` (Official Guide Test 1–6, Cambridge 14–19 Test 1–4), disimpan di `htdocs/app/data/speaking/sets.json`. |
| Descriptor | Teks resmi kata per kata dari `docs/source/ielts-speaking-band-descriptors.pdf`, disimpan di `htdocs/app/kb/speaking_descriptors.json`. |

## 3. Halaman

### 3.1 `/speaking` — Speaking (daftar + mulai)
- Disclaimer perangkat dan privasi audio.
- Status Cek Perangkat terakhir (disimpan di browser). Tombol ke halaman Cek Perangkat.
- Form mulai: nama murid (saran dari nama yang pernah dipakai), set soal, mode. Tombol "Mulai ujian".
- Daftar ujian Speaking terakhir (nama murid, set, mode, status, skor).

### 3.2 `/speaking/cek` — Panduan & Cek Perangkat
Daftar cek hijau/kuning/merah. Setiap merah punya petunjuk perbaikan berbahasa awam:
1. Browser didukung (Chrome/Edge terbaru; perlu WebAssembly, Web Worker, MediaRecorder, koneksi HTTPS).
2. Izin mikrofon (petunjuk: ikon gembok → Mikrofon → Izinkan → muat ulang).
3. Mic menangkap suara: indikator volume live + pilih mikrofon.
4. Alat transkripsi: tombol unduh model dengan progress bar (sekali saja, tersimpan di browser). Kartu grafis (WebGPU) dipakai bila ada, kalau gagal otomatis pindah ke prosesor (WASM).
5. Tes kecepatan & akurasi: examiner membaca satu kalimat contoh (±10 detik), teks hasilnya ditampilkan, kecepatan diukur → 🟢 Lancar / 🟡 Lambat / 🔴 Tidak disarankan.

Pengaman: kalau tab crash saat memuat model (ditandai di penyimpanan browser), saat dibuka lagi cek nomor 4 otomatis merah "perangkat ini tidak kuat memuat alat transkripsi". Peringatan lunak untuk HP/tablet.

### 3.3 `/speaking/{id}` — Ujian, penilaian, hasil (satu halaman, mengikuti status)
**Status `recording`** (layar ujian):
- Soal Part aktif tampil besar (Part 1: topik + pertanyaan; Part 2: cue card; Part 3: topik diskusi + pertanyaan).
- Tombol Mulai rekam / Selesai, durasi rekaman, indikator volume.
- Transkripsi berjalan di belakang layar (Part 1 ditranskripsi sambil Part 2 berlangsung). Transkrip tiap Part langsung disimpan ke server.
- Layar dijaga tetap menyala (Wake Lock). Rekaman terputus → examiner langsung diberi tahu.
- Peringatan "jangan tutup halaman" selama ada rekaman yang belum ditranskripsi.
- Setelah semua Part punya transkrip → tombol "Lanjut ke penilaian" (memicu AI).

**Status `review`** (penilaian examiner):
- Transkrip per Part. Examiner bisa klik kata untuk menandai "salah dengar" (bukan mengedit teks). Tombol "Nilai ulang LR/GRA dengan tanda ini".
- LR dan GRA terisi usulan AI (bisa diubah). FC dan P kosong (wajib).
- Kolom examiners' comment (opsional) + tombol "Pakai catatan AI sebagai draf".
- Tombol **Finalize**.

**Status `final`** (laporan):
- Skor keseluruhan + label (Skor simulasi / Estimasi latihan).
- Empat kartu kriteria: skor final + descriptor resmi band itu.
  - Pronunciation band 7/5/3: kalimat resmi + descriptor band bawah dan atas (bisa dilipat).
  - LR/GRA: contoh spesifik dari AI (✓ bagus, ✗ salah → perbaikan) selalu tampil; ringkasan AI hanya tampil kalau skor tidak diubah examiner.
- Examiner's comment (kalau ada), waktu finalisasi.
- Transkrip per Part (bisa dilipat).
- Tombol "Salin untuk murid" (format rapi untuk Google Docs) dan **Buka kembali**.

## 4. Data

Tabel baru `speakingtest` (lihat `htdocs/app/schema.sql`):
- `id`, `userId`, `studentName`, `setId`, `mode` (`p1|p2|p3|full`), `status` (`recording|review|final`)
- `transcripts` (JSON: `{ "p1": { "text": "...", "misheard": [indeks kata], "seconds": 95 }, ... }`)
- `aiResult` (JSON: band + ringkasan + contoh LR/GRA, model)
- `aiBandLr`, `aiBandGra` (usulan AI), `bandLr`, `bandGra`, `bandFc`, `bandPron` (final)
- `overallRaw`, `overall`, `examinerComment`, `model`, `promptVersion`, `lastErrorCode`, `pendingState`
- `createdAt`, `updatedAt`, `finalizedAt`

Usulan AI dan nilai final disimpan terpisah → bahan kalibrasi (seberapa sering examiner mengoreksi AI). **Tidak ada kolom audio.**

`llmcall.action`/`kind` ditambah nilai `speaking`.

## 5. AI

- Satu panggilan AI per request (aturan hosting). Penilaian LR+GRA = satu panggilan.
- Input: soal yang dijawab + transkrip per Part. Kata yang ditandai salah dengar dibungkus `⟦…⟧` dan diabaikan.
- Prompt menegaskan: ini bahasa lisan (jangan dinilai seperti esai; ejaan/tanda baca/huruf besar adalah buatan mesin transkripsi), transkrip otomatis bisa "lebih rapi" dari ucapan asli, nilai rata-rata performa di semua Part, gunakan descriptor LR/GRA resmi band 9–1, "harus memenuhi penuh fitur positif band itu".
- Output (JSON schema): per kriteria `evidence[]`, `band` (0–9), `summary` (2–3 kalimat, bahasa Inggris), `examples[]` (`quote` dari transkrip, `kind` good/error, `note`, `correction`).
- Transkrip total < 10 kata → ditolak dengan pesan, tidak memanggil AI.
- `PROMPT_VERSION` dinaikkan.

## 6. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Whisper salah dengar aksen | Model minimal base; examiner menandai salah dengar; examiner bisa mengubah skor. |
| Whisper "merapikan" grammar → GRA terlalu tinggi | Prompt memberi tahu AI; examiner memegang keputusan akhir. |
| Whisper membuang "uhm" | FC dinilai examiner, bukan AI. |
| Perangkat lemah / crash | Cek Perangkat + tes kecepatan + deteksi crash + disclaimer; WebGPU → WASM otomatis. |
| Rekaman panjang memberatkan memori | Rekam per Part; Whisper memproses per potongan 30 detik. |
| Halaman ditutup sebelum transkripsi selesai | Peringatan sebelum menutup; transkrip disimpan per Part begitu selesai. |

## 7. Di luar scope
- Pertanyaan lanjutan dibuat AI (Part 3 interaktif).
- Penilaian Pronunciation/FC oleh AI.
- Menyimpan atau mengunggah audio.
- Timer hitung mundur.
