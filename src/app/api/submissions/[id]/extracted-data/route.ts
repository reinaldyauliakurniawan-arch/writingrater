import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { getOwnedSubmission, requireUser, updateOwnedSubmission } from "@/lib/authz";
import { checkExtractedData, ExtractedData } from "@/lib/llm/schemas";
import type { IdContext } from "@/lib/routeUtils";

const Body = z.object({ extracted_data: ExtractedData });

export const PUT = handle(async (req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = Body.parse(await readJson(req));
  if (checkExtractedData(body.extracted_data)) throw new AppError("VALIDATION_ERROR");
  const sub = await getOwnedSubmission(id, user.id);
  if (sub.status === "graded") throw new AppError("SUBMISSION_LOCKED");
  if (sub.status !== "extracted" && sub.status !== "confirmed") throw new AppError("VALIDATION_ERROR");
  await updateOwnedSubmission(sub.id, user.id, {
    extractedData: body.extracted_data as unknown as Prisma.InputJsonValue,
    status: "confirmed",
  });
  return ok({ extracted_data: body.extracted_data });
});
