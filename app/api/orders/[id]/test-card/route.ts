import { handle } from "@/lib/http";
import { payWithSandboxCard } from "@/lib/orders";

export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[id]/test-card">) {
  return handle(async () => ({ authorizationId: await payWithSandboxCard((await ctx.params).id) }));
}
