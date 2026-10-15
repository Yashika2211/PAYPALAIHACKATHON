import { handle } from "@/lib/http";
import { captureAllocation } from "@/lib/orders";

// M1: the merchant marks delivery by hand (a human actor). M5 adds the photo DeliveryVerifier.
export async function POST(_req: Request, ctx: RouteContext<"/api/allocations/[id]/deliver">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await captureAllocation(id, { actor: "human", deliveryVerified: true });
    return { ok: true };
  });
}
