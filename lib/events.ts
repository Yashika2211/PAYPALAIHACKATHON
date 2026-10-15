import { and, asc, eq, gt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export type EventKind =
  | "rfq_planned"
  | "mandate_signed"
  | "rfq_sent"
  | "offer"
  | "counter"
  | "offer_rejected"
  | "firewall"
  | "quarantine"
  | "negotiation_done"
  | "bundle_ready"
  | "bundle_failed"
  | "paypal"
  | "order_state"
  | "delivery"
  | "payout";

export async function emit(
  kind: EventKind,
  payload: Record<string, unknown>,
  ids: { rfqId?: string | null; orderId?: string | null },
) {
  await db.insert(schema.events).values({
    kind,
    payload,
    rfqId: ids.rfqId ?? null,
    orderId: ids.orderId ?? null,
  });
}

export function eventsSince(ids: { rfqId?: string; orderId?: string }, afterSeq: number) {
  const scope = [
    ids.rfqId ? eq(schema.events.rfqId, ids.rfqId) : undefined,
    ids.orderId ? eq(schema.events.orderId, ids.orderId) : undefined,
  ].filter(Boolean);
  return db
    .select()
    .from(schema.events)
    .where(and(gt(schema.events.seq, afterSeq), or(...scope)))
    .orderBy(asc(schema.events.seq))
    .limit(200);
}
