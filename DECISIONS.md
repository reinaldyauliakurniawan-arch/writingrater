# DECISIONS

Format: tanggal — keputusan — alasan.

- 2026-10-06 — Versi terpasang: Next.js 16.3.8, React 19.2.8, Tailwind CSS 4, next-auth 5.0.0-beta.32, ai 7.x, zod 4.x, Prisma 6.19, vitest 5 — dari `create-next-app@latest` dan npm saat inisialisasi.
- 2026-10-06 — Prisma dikunci di major 6 (bukan 7) — Prisma 7 tidak lagi mendukung `url = env(...)` di `datasource`, sedangkan skema di spec memakai bentuk itu dan generator `prisma-client-js`.
- 2026-10-06 — `prisma.config.ts` memuat `.env.local` lewat `process.loadEnvFile` — Prisma CLI hanya membaca `.env`; spec memakai `.env.local`, jadi `npx prisma migrate dev` tetap jalan tanpa file `.env` duplikat.
- 2026-10-06 — Enum Prisma ditulis satu nilai per baris — format satu baris di spec tidak diterima parser Prisma; nilai dan urutannya identik.
- 2026-10-06 — Tetap memakai `src/middleware.ts` walau Next.js 16 menandainya deprecated (diganti `proxy.ts`) — spec mewajibkan nama file persis; middleware masih didukung (runtime edge), muncul peringatan deprecation saat `npm run dev`.
- 2026-10-06 — Konfigurasi Auth.js dipisah: `src/auth.config.ts` (aman untuk edge, dipakai middleware) dan `src/auth.ts` (Credentials + Prisma + bcrypt) — middleware berjalan di edge runtime yang tidak bisa memuat Prisma/bcrypt.
- 2026-10-06 — Middleware menjawab route `/api/*` tanpa login dengan JSON 401 `UNAUTHORIZED`, halaman di-redirect ke `/login` — sesuai bagian 7 (respons API selalu JSON).
- 2026-10-06 — Design token ditulis di `src/app/globals.css` lewat `@theme` (bukan `tailwind.config`) — Tailwind 4 tidak lagi memakai `tailwind.config` secara default; nama token (`primary`, `shadow-card`, dst.) sama dengan spec.
- 2026-10-06 — `@types/node` dinaikkan ke 22 — peer dependency vitest 5 menolak `@types/node@20` bawaan create-next-app.
- 2026-10-06 — Komponen kelas utilitas (`.btn-primary`, `.card`, `.input`, dst.) didefinisikan di `globals.css` — menghindari pengulangan kelas Tailwind tanpa menambah component library.
- 2026-10-06 — Ditambah `tsx` (dev) untuk `npm run calibrate` — menjalankan `scripts/calibrate.ts` langsung di PowerShell/cmd.
- 2026-10-06 — `Submission.promptText` tanpa `@default("")`; nilai `""` selalu diisi eksplisit saat membuat submission — MySQL menolak default literal di kolom TEXT (error 1101), dan default ekspresi `('')` membuat Prisma selalu mendeteksi drift. Kolom tetap NOT NULL, perilaku sama.
- 2026-10-06 — Pembacaan env dipindah dari `config.ts` ke `src/lib/env.ts` (`import "server-only"`) — `config.ts` ikut ter-import browser lewat `countWords`; env non-`NEXT_PUBLIC_` tidak boleh ada di bundle browser.
- 2026-10-06 — Sumber descriptor: `docs/source/ielts_writing_band_descriptors.pdf` (Updated May 2023). `writingbanddescriptorstask1and2.pdf` adalah versi publik lama dan tidak dipakai — spec hanya mengizinkan versi Mei 2023.
- 2026-10-06 — `descriptors.json` dibuat sekali dengan skrip ekstraksi (pdfjs-dist, di luar project): kolom dari posisi judul kolom, baris band dari sel tabel yang digambar di PDF, tebal dari nama font `OpenSans-Bold`. Diverifikasi otomatis: setiap kata PDF ada di output (kecuali General Training/prefiks Academic) dan semua teks tebal masuk `negative` — transkripsi kata per kata tanpa menulis dari ingatan.
- 2026-10-06 — Satu elemen array = satu kalimat (bukan satu paragraf) — jarak antarparagraf di PDF kadang sama dengan jarak antarbaris sehingga batas paragraf tidak bisa dibaca andal; spec membolehkan "satu kalimat atau satu paragraf".
- 2026-10-06 — Kalimat yang hanya sebagian tebal (5 kalimat, mis. "There is little relevant message, or the entire response may be off-topic.") masuk `negative` utuh — bagian tebalnya fitur pembatas, dan memotong kalimat akan mengubah teks descriptor.
- 2026-10-06 — Prefiks negatif ditulis `- [LIMITING] <kalimat>` — spasi di sekitar `[LIMITING]` pada spec dianggap artefak format; teks prompt grade merujuk "Lines marked [LIMITING]".
