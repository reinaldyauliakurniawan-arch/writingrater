// Database soal di source code: data/questions/questions.json + gambar Task 1 di data/questions/images/.
// Jalankan:
//   npm run questions:seed    -> masukkan soal dari repo ke database (soal dengan nama yang sudah ada dilewati)
//   npm run questions:export  -> tulis ulang file repo dari isi database (setelah menambah soal lewat app)
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { checkExtractedData, ExtractedData } from "../src/lib/llm/schemas";

const ROOT = process.cwd();
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const DATA_DIR = path.join(ROOT, "data", "questions");
const JSON_FILE = path.join(DATA_DIR, "questions.json");
const IMG_DIR = path.join(DATA_DIR, "images");
const UPLOAD_ROOT = path.resolve(ROOT, process.env.UPLOAD_DIR || "storage/uploads");

const Item = z.object({
  name: z.string().min(1).max(150),
  task_type: z.enum(["task1_academic", "task2"]),
  prompt_text: z.string(),
  image_file: z.string().nullable(), // relatif ke data/questions/images
  extracted_data: ExtractedData.nullable(),
});
type Item = z.infer<typeof Item>;

const prisma = new PrismaClient();

/** "Cambridge 19 Test 1 Task 1" -> "cambridge-19-test-1-task-1" */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Urutan alami: "Cambridge 9" sebelum "Cambridge 10".
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true });

async function seed() {
  const items = z.array(Item).parse(JSON.parse(fs.readFileSync(JSON_FILE, "utf8")));
  const adminEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase();
  const admin = adminEmail ? await prisma.user.findUnique({ where: { email: adminEmail } }) : null;
  let created = 0;
  for (const it of items) {
    if (await prisma.question.findFirst({ where: { taskType: it.task_type, name: it.name } })) continue;
    if (it.extracted_data && checkExtractedData(it.extracted_data)) throw new Error(`${it.name}: data grafik tidak valid`);
    const id = randomUUID();
    let imagePath: string | null = null;
    if (it.image_file) {
      imagePath = `questions/${id}${path.extname(it.image_file)}`;
      fs.mkdirSync(path.join(UPLOAD_ROOT, "questions"), { recursive: true });
      fs.copyFileSync(path.join(IMG_DIR, it.image_file), path.join(UPLOAD_ROOT, imagePath));
    }
    await prisma.question.create({
      data: {
        id,
        taskType: it.task_type,
        name: it.name,
        promptText: it.prompt_text,
        imagePath,
        extractedData: it.extracted_data ?? Prisma.DbNull,
        createdById: admin?.id ?? null,
      },
    });
    created++;
  }
  console.log(`Seed selesai: ${created} soal baru, ${items.length - created} sudah ada.`);
}

async function exportQuestions() {
  const list = (await prisma.question.findMany()).sort(byName);
  fs.rmSync(IMG_DIR, { recursive: true, force: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const items: Item[] = list.map((q) => {
    let image_file: string | null = null;
    if (q.imagePath) {
      image_file = `${slug(q.name)}${path.extname(q.imagePath)}`;
      fs.copyFileSync(path.join(UPLOAD_ROOT, q.imagePath), path.join(IMG_DIR, image_file));
    }
    return {
      name: q.name,
      task_type: q.taskType,
      prompt_text: q.promptText,
      image_file,
      extracted_data: (q.extractedData as ExtractedData | null) ?? null,
    };
  });
  fs.writeFileSync(JSON_FILE, JSON.stringify(items, null, 2) + "\n");
  console.log(`Ekspor selesai: ${items.length} soal ke ${path.relative(ROOT, DATA_DIR)}.`);
}

const mode = process.argv[2];
(mode === "seed" ? seed() : mode === "export" ? exportQuestions() : Promise.reject(new Error("pakai: seed | export")))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
