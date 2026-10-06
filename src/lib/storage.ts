import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/env";

export type ImageExt = "png" | "jpg" | "webp";

const MIME: Record<ImageExt, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Jenis gambar dari magic bytes (bukan ekstensi). null = bukan PNG/JPEG/WEBP. */
export function detectImageType(b: Uint8Array): ImageExt | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)
    return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  )
    return "webp";
  return null;
}

export const mimeOf = (relPath: string): string => MIME[path.extname(relPath).slice(1) as ImageExt] ?? "application/octet-stream";

function rootDir() {
  return path.resolve(process.cwd(), serverEnv().uploadDir);
}

/** Path absolut dari path relatif; menolak path yang keluar dari UPLOAD_DIR. */
function absolute(relPath: string) {
  const root = rootDir();
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("path di luar UPLOAD_DIR");
  return abs;
}

/** Simpan ke {UPLOAD_DIR}/{userId}/{submissionId}.{ext}; kembalikan path relatif (pemisah "/"). */
export async function saveImage(userId: string, submissionId: string, data: Uint8Array, ext: ImageExt) {
  const rel = `${userId}/${submissionId}.${ext}`;
  const abs = absolute(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return rel;
}

export async function readImage(relPath: string): Promise<{ data: Uint8Array; mimeType: string }> {
  const data = await fs.readFile(absolute(relPath));
  return { data: new Uint8Array(data), mimeType: mimeOf(relPath) };
}

export async function copyImage(relPath: string, userId: string, newSubmissionId: string) {
  const ext = path.extname(relPath).slice(1) as ImageExt;
  const rel = `${userId}/${newSubmissionId}.${ext}`;
  const dest = absolute(rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(absolute(relPath), dest);
  return rel;
}

export async function deleteImage(relPath: string) {
  try {
    await fs.unlink(absolute(relPath));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
