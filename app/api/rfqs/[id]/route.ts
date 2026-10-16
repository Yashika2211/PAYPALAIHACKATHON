import { handle } from "@/lib/http";
import { getSnapshot } from "@/lib/rfqs";

export async function GET(_req: Request, ctx: RouteContext<"/api/rfqs/[id]">) {
  return handle(async () => getSnapshot((await ctx.params).id));
}
