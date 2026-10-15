import { after } from "next/server";
import { handle } from "@/lib/http";
import { runNegotiation } from "@/lib/negotiation/engine";

export async function POST(_req: Request, ctx: RouteContext<"/api/rfqs/[id]/negotiate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    // Respond immediately; the UI follows progress through the events feed.
    after(() => runNegotiation(id).catch((err) => console.error("[negotiation]", err)));
    return { started: true };
  });
}
