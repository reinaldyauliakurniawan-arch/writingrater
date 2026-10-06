import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function keyFrom(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("SETTINGS_ENCRYPTION_KEY harus 64 karakter hex (32 byte).");
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM, IV acak 12 byte. Hasil: "<iv_b64>:<authTag_b64>:<ciphertext_b64>". */
export function encryptSecret(plain: string, keyHex = process.env.SETTINGS_ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFrom(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(enc: string, keyHex = process.env.SETTINGS_ENCRYPTION_KEY): string {
  const parts = enc.split(":");
  if (parts.length !== 3) throw new Error("Format secret terenkripsi tidak valid.");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(ALGO, keyFrom(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
