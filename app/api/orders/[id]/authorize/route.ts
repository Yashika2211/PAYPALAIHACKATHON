import { handle } from "@/lib/http";
import { authorizeOrder } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/authorize">) {
  return handle(async () => ({ authorizationId: await authorizeOrder((await ctx.params).id) }));
}
