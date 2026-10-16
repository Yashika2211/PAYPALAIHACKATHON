import { handle } from "@/lib/http";
import { payWithSandboxCard } from "@/lib/orders";

export async function POST(req: Request, ctx: RouteContext<"/api/orders/[id]/test-card">) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { saveForAgent?: boolean };
    return { authorizationId: await payWithSandboxCard((await ctx.params).id, { saveForAgent: body.saveForAgent === true }) };
  });
}
