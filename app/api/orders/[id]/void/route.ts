import { handle } from "@/lib/http";
import { voidRemaining } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/void">) {
  return handle(async () => {
    await voidRemaining((await ctx.params).id);
    return { ok: true };
  });
}
