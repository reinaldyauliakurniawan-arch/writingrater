import { handle, ok } from "@/lib/errors";
import { requireUser } from "@/lib/authz";
import { loadHistory } from "@/lib/historyView";

export const GET = handle(async () => {
  const user = await requireUser();
  return ok(await loadHistory(user.id));
});
