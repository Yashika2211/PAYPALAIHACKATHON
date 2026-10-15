import { handle } from "@/lib/http";
import { createPaypalOrder } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/paypal">) {
  return handle(async () => ({ paypalOrderId: await createPaypalOrder((await ctx.params).id) }));
}
