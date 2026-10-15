import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { processWebhookEvent } from "@/lib/orders";
import { verifyWebhookSignature, type WebhookEvent } from "@/lib/paypal/webhooks";

/**
 * PayPal webhook receiver. Verifies the signature with PayPal, stores the raw
 * event once (unique paypal_event_id), then processes idempotently.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  // Replayed fixtures (scripts/replay-webhooks.ts) are only accepted in local dev.
  const replay = process.env.NODE_ENV !== "production" && req.headers.get("x-haggle-replay") === process.env.MANDATE_SIGNING_SECRET;
  let verified = false;
  try {
    verified = replay || (await verifyWebhookSignature(req.headers, event));
  } catch (err) {
    console.error("[webhook] verify failed", err instanceof Error ? err.message : err);
  }

  if (!verified) return Response.json({ error: "signature verification failed" }, { status: 400 });

  const [inserted] = await db
    .insert(schema.paypalEvents)
    .values({ paypalEventId: event.id, eventType: event.event_type, resourceId: event.resource?.id ?? null, raw: event, signatureVerified: true })
    .onConflictDoNothing()
    .returning();
  const stored = inserted ?? (await db.query.paypalEvents.findFirst({ where: eq(schema.paypalEvents.paypalEventId, event.id) }))!;
  // Already processed: acknowledge. Previously failed: PayPal is retrying, so process again.
  if (stored.processedAt) return Response.json({ ok: true, duplicate: true });

  try {
    const result = await processWebhookEvent(event);
    await db.update(schema.paypalEvents).set({ processedAt: new Date(), error: null }).where(eq(schema.paypalEvents.id, stored.id));
    return Response.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.paypalEvents).set({ error: message }).where(eq(schema.paypalEvents.id, stored.id));
    // 500 makes PayPal retry later.
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
