import { handle } from "@/lib/http";
import { refundAllocation } from "@/lib/orders";

export async function POST(req: Request, ctx: RouteContext<"/api/allocations/[id]/refund">) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    await refundAllocation((await ctx.params).id, body.reason ?? "");
    return { ok: true };
  });
}
