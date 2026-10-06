import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, handle, ok, readJson } from "@/lib/errors";

const RegisterInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(100),
});

export const POST = handle(async (req: Request) => {
  const body = RegisterInput.parse(await readJson(req));
  const email = body.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("EMAIL_TAKEN");
  const passwordHash = await bcrypt.hash(body.password, 10);
  try {
    const user = await prisma.user.create({ data: { email, name: body.name, passwordHash } });
    return ok({ id: user.id }, 201);
  } catch (e) {
    // Balapan dua pendaftaran dengan email sama -> unique constraint.
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") throw new AppError("EMAIL_TAKEN");
    throw e;
  }
});
