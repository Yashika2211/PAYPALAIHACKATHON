import { issueInvoice } from "@/lib/agents/billing-agent";
import { handle } from "@/lib/http";

/** Business buyers: pay by PayPal invoice on Net 15 terms instead of a hold. */
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/invoice">) {
  return handle(async () => issueInvoice((await ctx.params).id));
}
