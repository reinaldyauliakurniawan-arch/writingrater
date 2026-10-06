import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma CLI hanya membaca .env secara default; project ini memakai .env.local.
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
});
