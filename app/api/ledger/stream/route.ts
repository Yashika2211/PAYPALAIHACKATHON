import { allEventsSince } from "@/lib/events";

/** SSE of every event, for the live ledger. Resumes from Last-Event-ID. */
export async function GET(req: Request) {
  let after = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send("retry: 1500\n\n");
      let idle = 0;
      while (!req.signal.aborted) {
        try {
          const rows = await allEventsSince(after);
          if (rows.length) {
            after = rows[rows.length - 1].seq;
            // Batch per tick so the grid applies one transaction per batch.
            send(`id: ${after}\ndata: ${JSON.stringify(rows)}\n\n`);
            idle = 0;
            continue;
          }
          if (++idle % 30 === 0) send(": ping\n\n");
        } catch {
          send(": db hiccup\n\n");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
