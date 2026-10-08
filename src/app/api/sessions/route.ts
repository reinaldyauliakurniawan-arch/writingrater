import { handle, ok } from "@/lib/errors";
import { createOwnedSession, requireUser } from "@/lib/authz";

export const POST = handle(async () => {
  const user = await requireUser();
  const session = await createOwnedSession(user.id);
  return ok({ id: session.id }, 201);
});
