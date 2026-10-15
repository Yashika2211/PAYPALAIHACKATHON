import { eventsSince } from "@/lib/events";

/**
 * Server-Sent Events feed for the Negotiation Theater. Tails the append-only
 * events table, so it works no matter which process (web or worker) wrote them.
 * Resumes from Last-Event-ID after a reconnect.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/rfqs/[id]/stream">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  let after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send("retry: 1500\n\n");
      let idle = 0;
      while (!req.signal.aborted) {
        try {
          const rows = await eventsSince({ rfqId: id }, after);
          for (const e of rows) {
            after = e.seq;
            send(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
          }
          idle = rows.length ? 0 : idle + 1;
          // Heartbeat keeps proxies (Render, Cloudflare) from closing an idle stream.
          if (idle > 0 && idle % 30 === 0) send(": ping\n\n");
        } catch {
          send(": db hiccup\n\n");
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
