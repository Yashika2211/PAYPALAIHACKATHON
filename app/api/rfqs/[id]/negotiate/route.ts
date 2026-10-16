import { after } from "next/server";
import { handle } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { runNegotiation } from "@/lib/negotiation/engine";

export async function POST(req: Request, ctx: RouteContext<"/api/rfqs/[id]/negotiate">) {
  return handle(async () => {
    limit(req, "negotiate");
    const { id } = await ctx.params;
    // Respond immediately; the UI follows progress through the events feed.
    after(() => runNegotiation(id).catch((err) => console.error("[negotiation]", err)));
    return { started: true };
  });
}
