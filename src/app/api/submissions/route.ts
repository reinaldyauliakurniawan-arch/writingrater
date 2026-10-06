import { z } from "zod";
import { AppError, handle, ok, readJson } from "@/lib/errors";
import { createOwnedSubmission, getOwnedSession, requireUser, sessionSlotTaken } from "@/lib/authz";

const Body = z.object({
  task_type: z.enum(["task1_academic", "task2"]),
  session_id: z.string().uuid().optional(),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  if (body.session_id) {
    await getOwnedSession(body.session_id, user.id);
    if (await sessionSlotTaken(body.session_id, user.id, body.task_type)) throw new AppError("SESSION_SLOT_TAKEN");
  }
  try {
    const sub = await createOwnedSubmission(user.id, body.task_type, body.session_id ?? null);
    return ok({ id: sub.id }, 201);
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") throw new AppError("SESSION_SLOT_TAKEN");
    throw e;
  }
});
