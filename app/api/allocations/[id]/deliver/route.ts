import { handle } from "@/lib/http";
import { deliver } from "@/lib/orders";

// Human confirmation of delivery (the override when the AI photo check can't verify it).
export async function POST(_req: Request, ctx: RouteContext<"/api/allocations/[id]/deliver">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await deliver(id, { actor: "human", deliveryVerified: true });
    return { ok: true };
  });
}
