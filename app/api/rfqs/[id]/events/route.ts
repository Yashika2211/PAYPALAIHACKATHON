import { eventsSince } from "@/lib/events";
import { handle } from "@/lib/http";

export async function GET(req: Request, ctx: RouteContext<"/api/rfqs/[id]/events">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
    return { events: await eventsSince({ rfqId: id }, after) };
  });
}
