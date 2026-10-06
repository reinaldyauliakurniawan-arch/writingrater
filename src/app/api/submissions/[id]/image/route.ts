import { AppError, handle, ok } from "@/lib/errors";
import { getOwnedSubmission, requireUser, updateOwnedSubmission } from "@/lib/authz";
import { MAX_IMAGE_BYTES } from "@/lib/config";
import { deleteImage, detectImageType, readImage, saveImage } from "@/lib/storage";
import { resetExtractionIfNeeded, type IdContext } from "@/lib/routeUtils";

export const runtime = "nodejs";

export const POST = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    throw new AppError("INVALID_IMAGE");
  }
  if (!file || typeof file === "string" || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new AppError("INVALID_IMAGE");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const ext = detectImageType(data);
  if (!ext) throw new AppError("INVALID_IMAGE");

  const rel = await saveImage(user.id, sub.id, data, ext);
  if (sub.promptImagePath && sub.promptImagePath !== rel) await deleteImage(sub.promptImagePath);
  await updateOwnedSubmission(sub.id, user.id, { promptImagePath: rel, ...resetExtractionIfNeeded(sub) });
  return ok({ prompt_image_url: `/api/submissions/${sub.id}/image` });
});

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmission(id, user.id);
  if (!sub.promptImagePath) throw new AppError("NOT_FOUND");
  let img;
  try {
    img = await readImage(sub.promptImagePath);
  } catch {
    throw new AppError("NOT_FOUND");
  }
  return new Response(Buffer.from(img.data), {
    headers: { "Content-Type": img.mimeType, "Cache-Control": "private, no-store" },
  });
});

export const DELETE = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  if (sub.promptImagePath) await deleteImage(sub.promptImagePath);
  await updateOwnedSubmission(sub.id, user.id, { promptImagePath: null, ...resetExtractionIfNeeded(sub) });
  return ok({});
});
