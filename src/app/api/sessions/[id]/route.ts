import { handle, ok } from "@/lib/errors";
import { requireUser } from "@/lib/authz";
import { loadSessionView } from "@/lib/sessionView";
import type { IdContext } from "@/lib/routeUtils";

export const GET = handle(async (_req: Request, ctx: IdContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return ok(await loadSessionView(id, user.id));
});
