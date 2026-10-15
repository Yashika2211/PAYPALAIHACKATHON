import { handle } from "@/lib/http";
import { retryPayout } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/allocations/[id]/retry-payout">) {
  return handle(async () => {
    await retryPayout((await ctx.params).id);
    return { ok: true };
  });
}
