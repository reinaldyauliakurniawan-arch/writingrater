import { handle, ok } from "@/lib/errors";
import { requireUser } from "@/lib/authz";
import { getUsage } from "@/lib/limits";

export const GET = handle(async () => {
  const user = await requireUser();
  return ok(await getUsage(user.id));
});
