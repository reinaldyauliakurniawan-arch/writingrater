import { AppError, handle } from "@/lib/errors";
import { requireUser } from "@/lib/authz";
import { getQuestion } from "@/lib/questions";
import { readImage } from "@/lib/storage";
import type { IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const q = await getQuestion(id);
  if (!q.imagePath) throw new AppError("NOT_FOUND");
  let img;
  try {
    img = await readImage(q.imagePath);
  } catch {
    throw new AppError("NOT_FOUND");
  }
  return new Response(Buffer.from(img.data), {
    headers: { "Content-Type": img.mimeType, "Cache-Control": "private, no-store" },
  });
});
