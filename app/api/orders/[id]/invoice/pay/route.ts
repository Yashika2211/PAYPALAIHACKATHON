import { handle } from "@/lib/http";
import { recordInvoicePaid } from "@/lib/orders";

/** Sandbox only: stands in for the buyer paying the invoice. */
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/invoice/pay">) {
  return handle(async () => ({ status: await recordInvoicePaid((await ctx.params).id) }));
}
