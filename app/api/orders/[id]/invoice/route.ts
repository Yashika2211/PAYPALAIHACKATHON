import { issueInvoice } from "@/lib/agents/billing-agent";
import { handle } from "@/lib/http";
import { limit } from "@/lib/rate-limit";

/** Business buyers: pay by PayPal invoice on Net 15 terms instead of a hold. */
export async function POST(req: Request, ctx: RouteContext<"/api/orders/[id]/invoice">) {
  return handle(async () => {
    limit(req, "invoice");
    return issueInvoice((await ctx.params).id);
  });
}
