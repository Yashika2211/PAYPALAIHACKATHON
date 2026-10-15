import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { guard } from "@/lib/firewall";
import * as pp from "@/lib/paypal/api";
import { deriveSettlementState, transition, type OrderState } from "@/lib/state/order-machine";
import type { WebhookEvent } from "@/lib/paypal/webhooks";

/*
 * Settlement service. Client callbacks and PayPal webhooks both funnel into the
 * same idempotent apply* functions, and each one reads PayPal's own response
 * (never client-supplied amounts or statuses).
 */

async function loadOrder(orderId: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new Error("Order not found");
  const allocations = await db.query.merchantAllocations.findMany({
    where: eq(schema.merchantAllocations.orderId, orderId),
  });
  return { order, allocations };
}

async function categoryOf(merchantIds: string[]) {
  const rows = await db.query.merchants.findMany({ where: inArray(schema.merchants.id, merchantIds) });
  return new Map(rows.map((m) => [m.id, m]));
}

export async function recomputeOrderState(orderId: string): Promise<OrderState> {
  const { order, allocations } = await loadOrder(orderId);
  const derived = deriveSettlementState(allocations.map((a) => a.state));
  if (!derived || derived === order.state) return order.state;
  try {
    const next = transition(order.state, derived);
    await db.update(schema.orders).set({ state: next }).where(eq(schema.orders.id, orderId));
    await emit("order_state", { from: order.state, to: next }, { rfqId: order.rfqId, orderId });
    return next;
  } catch (err) {
    console.error("order state", err instanceof Error ? err.message : err);
    return order.state;
  }
}

/** Runs the human's approval of the bundle through the firewall. */
async function approveBundle(order: typeof schema.orders.$inferSelect, allocations: Array<typeof schema.merchantAllocations.$inferSelect>) {
  if (order.state !== "mandate_signed") throw new Error(`Order is ${order.state}`);

  const merchants = await categoryOf(allocations.map((a) => a.merchantId));
  const decision = await guard({
    mandateId: order.mandateId,
    rfqId: order.rfqId,
    orderId: order.id,
    actor: "human",
    actorLabel: "buyer (approve bundle)",
    action: {
      type: "authorize_payment",
      amountCents: order.totalCents,
      lines: allocations.map((a) => ({
        merchantId: a.merchantId,
        category: merchants.get(a.merchantId)!.category,
        amountCents: a.amountCents,
      })),
    },
  });
  if (decision.decision !== "allow") throw new Error(`Mandate Firewall: ${decision.reasons.join("; ")}`);
}

/** Creates the PayPal AUTHORIZE order after the human approves the bundle. */
export async function createPaypalOrder(orderId: string) {
  const { order, allocations } = await loadOrder(orderId);
  if (order.paypalOrderId) return order.paypalOrderId;
  await approveBundle(order, allocations);

  const created = await pp.createAuthorizeOrder({
    orderId,
    description: `Haggle bundle (${allocations.length} merchants)`,
    lines: allocations.map((a) => ({ merchantId: a.merchantId, name: a.description, amountCents: a.amountCents })),
  });
  await db.update(schema.orders).set({ paypalOrderId: created.id }).where(eq(schema.orders.id, orderId));
  await emit("paypal", { step: "order_created", paypalOrderId: created.id, status: created.status }, { rfqId: order.rfqId, orderId });
  return created.id;
}

/**
 * Sandbox-only checkout with PayPal's test card: the order is created and
 * authorized in one server call, so judges can run the flow without a sandbox login.
 */
export async function payWithSandboxCard(orderId: string) {
  if (process.env.PAYPAL_ENV === "live") throw new Error("Test cards are sandbox-only");
  const { order, allocations } = await loadOrder(orderId);
  if (order.paypalAuthorizationId) return order.paypalAuthorizationId;
  await approveBundle(order, allocations);

  const created = await pp.createAuthorizeOrder({
    orderId,
    testCard: true,
    description: `Haggle bundle (${allocations.length} merchants)`,
    lines: allocations.map((a) => ({ merchantId: a.merchantId, name: a.description, amountCents: a.amountCents })),
  });
  await db.update(schema.orders).set({ paypalOrderId: created.id }).where(eq(schema.orders.id, orderId));
  await emit("paypal", { step: "order_created", paypalOrderId: created.id, status: created.status, source: "sandbox_card" }, { rfqId: order.rfqId, orderId });
  const auth = created.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error(`PayPal did not authorize the card (status ${created.status})`);
  await applyAuthorization(orderId, auth.id, auth.status);
  return auth.id;
}

/** Called after buyer approval in the PayPal popup. Authorizes and applies PayPal's response. */
export async function authorizeOrder(orderId: string) {
  const { order } = await loadOrder(orderId);
  if (!order.paypalOrderId) throw new Error("No PayPal order");
  if (order.paypalAuthorizationId) return order.paypalAuthorizationId;
  const res = await pp.authorizeOrder(order.paypalOrderId, orderId);
  const auth = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("PayPal returned no authorization");
  await applyAuthorization(orderId, auth.id, auth.status);
  return auth.id;
}

export async function applyAuthorization(orderId: string, authorizationId: string, status: string) {
  if (status !== "CREATED" && status !== "PENDING") return;
  const updated = await db
    .update(schema.orders)
    .set({ paypalAuthorizationId: authorizationId })
    .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.paypalAuthorizationId)))
    .returning();
  if (updated.length === 0) return; // already applied (webhook or callback got here first)
  const order = updated[0];

  await db
    .update(schema.merchantAllocations)
    .set({ state: "authorized" })
    .where(and(eq(schema.merchantAllocations.orderId, orderId), eq(schema.merchantAllocations.state, "pending")));
  if (order.mandateId) {
    await db
      .update(schema.mandates)
      .set({ spentCents: dsql`${schema.mandates.spentCents} + ${order.totalCents}` })
      .where(eq(schema.mandates.id, order.mandateId));
  }
  await emit("paypal", { step: "authorized", authorizationId, amountCents: order.totalCents, paypalOrderId: order.paypalOrderId }, { rfqId: order.rfqId, orderId });
  await recomputeOrderState(orderId);
}

/** Captures one merchant's share. Requires the firewall to allow the capture. */
export async function captureAllocation(
  allocationId: string,
  opts: { actor: "human" | "system"; deliveryVerified: boolean },
) {
  const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) });
  if (!alloc) throw new Error("Allocation not found");
  if (alloc.state === "captured") return alloc;
  if (alloc.state !== "authorized") throw new Error(`Allocation is ${alloc.state}`);
  const { order, allocations } = await loadOrder(alloc.orderId);
  if (!order.paypalAuthorizationId) throw new Error("Order is not authorized");

  const decision = await guard({
    mandateId: order.mandateId,
    rfqId: order.rfqId,
    orderId: order.id,
    actor: opts.actor,
    actorLabel: opts.actor === "human" ? "merchant (marked delivered)" : "settlement-system",
    action: { type: "capture_payment", merchantId: alloc.merchantId, amountCents: alloc.amountCents, deliveryVerified: opts.deliveryVerified },
  });
  if (decision.decision !== "allow") throw new Error(`Mandate Firewall: ${decision.reasons.join("; ")}`);

  const stillOpen = allocations.filter((a) => a.state === "authorized" && a.id !== alloc.id);
  const requestId = `capture-${alloc.id}`;
  await db.update(schema.merchantAllocations).set({ captureRequestId: requestId }).where(eq(schema.merchantAllocations.id, alloc.id));

  const capture = await pp.captureAuthorization({
    authorizationId: order.paypalAuthorizationId,
    amountCents: alloc.amountCents,
    finalCapture: stillOpen.length === 0,
    requestId,
    invoiceId: alloc.id,
    orderId: order.id,
    note: alloc.description,
  });
  await applyCapture(alloc.id, capture.id, capture.status);
  await payoutAllocation(alloc.id);
  return alloc;
}

export async function applyCapture(allocationId: string, captureId: string, status: string) {
  if (status !== "COMPLETED" && status !== "PENDING") return;
  const updated = await db
    .update(schema.merchantAllocations)
    .set({ state: "captured", paypalCaptureId: captureId })
    .where(and(eq(schema.merchantAllocations.id, allocationId), eq(schema.merchantAllocations.state, "authorized")))
    .returning();
  if (updated.length === 0) return;
  const a = updated[0];
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) });
  const merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, a.merchantId) });
  await emit(
    "paypal",
    { step: "captured", captureId, allocationId, merchant: merchant?.name, amountCents: a.amountCents },
    { rfqId: order?.rfqId, orderId: a.orderId },
  );
  await recomputeOrderState(a.orderId);
}

/** Payouts v1: pays the merchant their share minus Haggle's platform fee. */
export async function payoutAllocation(allocationId: string) {
  const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) });
  if (!alloc || alloc.state !== "captured") return;
  const existing = await db.query.payouts.findFirst({ where: eq(schema.payouts.allocationId, allocationId) });
  if (existing?.payoutBatchId) return;

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, alloc.orderId) });
  const merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, alloc.merchantId) });
  if (!order || !merchant) return;
  const feeCents = Math.round((alloc.amountCents * order.platformFeeBps) / 10_000);
  const netCents = alloc.amountCents - feeCents;

  const [row] = existing
    ? [existing]
    : await db
        .insert(schema.payouts)
        .values({ allocationId, merchantId: merchant.id, grossCents: alloc.amountCents, feeCents, netCents })
        .onConflictDoNothing()
        .returning();
  if (!row) return;

  const batch = await pp.createPayout({
    senderBatchId: `payout-${allocationId}`,
    orderId: order.id,
    items: [{ allocationId, email: merchant.payoutEmail, netCents, note: `Haggle order ${order.id.slice(0, 8)}: ${alloc.description}` }],
  });
  await db
    .update(schema.payouts)
    .set({ payoutBatchId: batch.batch_header.payout_batch_id, payoutItemId: batch.items?.[0]?.payout_item_id })
    .where(eq(schema.payouts.id, row.id));
  await emit(
    "payout",
    { step: "sent", allocationId, merchant: merchant.name, grossCents: alloc.amountCents, feeCents, netCents, batchId: batch.batch_header.payout_batch_id, status: batch.batch_header.batch_status },
    { rfqId: order.rfqId, orderId: order.id },
  );
}

/** Re-sends a failed or unclaimed payout to the merchant's current payout email. */
export async function retryPayout(allocationId: string) {
  const payout = await db.query.payouts.findFirst({ where: eq(schema.payouts.allocationId, allocationId) });
  if (!payout) throw new Error("No payout for this allocation");
  if (payout.status !== "failed" && payout.status !== "unclaimed") throw new Error(`Payout is ${payout.status}`);
  const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) });
  const merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, payout.merchantId) });
  const order = alloc && (await db.query.orders.findFirst({ where: eq(schema.orders.id, alloc.orderId) }));
  if (!alloc || !merchant || !order) throw new Error("Payout records are incomplete");

  const batch = await pp.createPayout({
    senderBatchId: `payout-${allocationId}-retry-${Date.now()}`,
    orderId: order.id,
    items: [{ allocationId, email: merchant.payoutEmail, netCents: payout.netCents, note: `Haggle order ${order.id.slice(0, 8)} (retry): ${alloc.description}` }],
  });
  await db
    .update(schema.payouts)
    .set({ status: "pending", payoutBatchId: batch.batch_header.payout_batch_id, payoutItemId: batch.items?.[0]?.payout_item_id })
    .where(eq(schema.payouts.id, payout.id));
  await emit(
    "payout",
    { step: "retried", allocationId, merchant: merchant.name, netCents: payout.netCents, batchId: batch.batch_header.payout_batch_id },
    { rfqId: order.rfqId, orderId: order.id },
  );
}

/** Voids whatever is still held: undelivered goods are never charged. */
export async function voidRemaining(orderId: string) {
  const { order, allocations } = await loadOrder(orderId);
  const open = allocations.filter((a) => a.state === "authorized");
  if (!order.paypalAuthorizationId || open.length === 0) return;
  const decision = await guard({
    mandateId: order.mandateId,
    rfqId: order.rfqId,
    orderId,
    actor: "human",
    actorLabel: "buyer (release hold)",
    action: { type: "void_authorization" },
  });
  if (decision.decision !== "allow") throw new Error(`Mandate Firewall: ${decision.reasons.join("; ")}`);
  await pp.voidAuthorization(order.paypalAuthorizationId, orderId);
  await applyVoid(order.paypalAuthorizationId);
}

export async function applyVoid(authorizationId: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.paypalAuthorizationId, authorizationId) });
  if (!order) return;
  const voided = await db
    .update(schema.merchantAllocations)
    .set({ state: "voided" })
    .where(and(eq(schema.merchantAllocations.orderId, order.id), eq(schema.merchantAllocations.state, "authorized")))
    .returning();
  if (voided.length === 0) return;
  const released = voided.reduce((s, a) => s + a.amountCents, 0);
  if (order.mandateId) {
    await db
      .update(schema.mandates)
      .set({ spentCents: dsql`greatest(0, ${schema.mandates.spentCents} - ${released})` })
      .where(eq(schema.mandates.id, order.mandateId));
  }
  await emit("paypal", { step: "voided", authorizationId, releasedCents: released }, { rfqId: order.rfqId, orderId: order.id });
  await recomputeOrderState(order.id);
}

/** Refunds a captured merchant share back to the buyer (dispute or cancellation). */
export async function refundAllocation(allocationId: string, reason: string) {
  const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) });
  if (!alloc?.paypalCaptureId || alloc.state !== "captured") throw new Error("Only captured lines can be refunded");
  const { order } = await loadOrder(alloc.orderId);
  const decision = await guard({
    mandateId: order.mandateId,
    rfqId: order.rfqId,
    orderId: order.id,
    actor: "human",
    actorLabel: "buyer (refund)",
    action: { type: "refund", amountCents: alloc.amountCents },
  });
  if (decision.decision !== "allow") throw new Error(`Mandate Firewall: ${decision.reasons.join("; ")}`);
  const refund = await pp.refundCapture(alloc.paypalCaptureId, alloc.amountCents, order.id, reason || "Refund via Haggle");
  await applyRefund(alloc.id, refund.id);
}

export async function applyRefund(allocationId: string, refundId: string) {
  const updated = await db
    .update(schema.merchantAllocations)
    .set({ state: "refunded" })
    .where(and(eq(schema.merchantAllocations.id, allocationId), eq(schema.merchantAllocations.state, "captured")))
    .returning();
  if (updated.length === 0) return;
  const a = updated[0];
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) });
  const merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.id, a.merchantId) });
  if (order?.mandateId) {
    await db
      .update(schema.mandates)
      .set({ spentCents: dsql`greatest(0, ${schema.mandates.spentCents} - ${a.amountCents})` })
      .where(eq(schema.mandates.id, order.mandateId));
  }
  await emit("paypal", { step: "refunded", refundId, allocationId, merchant: merchant?.name, amountCents: a.amountCents }, { rfqId: order?.rfqId, orderId: a.orderId });
  await recomputeOrderState(a.orderId);
}

/** Idempotent webhook processing. Returns a short description of what was applied. */
export async function processWebhookEvent(event: WebhookEvent): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PayPal resource shapes vary by event type
  const r = event.resource as Record<string, any>;
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      const order = await db.query.orders.findFirst({ where: eq(schema.orders.paypalOrderId, String(r.id)) });
      if (order) await emit("paypal", { step: "approved_webhook", paypalOrderId: r.id }, { rfqId: order.rfqId, orderId: order.id });
      return "noted approval";
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const paypalOrderId = r.supplementary_data?.related_ids?.order_id;
      const order = paypalOrderId
        ? await db.query.orders.findFirst({ where: eq(schema.orders.paypalOrderId, String(paypalOrderId)) })
        : undefined;
      if (!order) return "no matching order";
      await applyAuthorization(order.id, String(r.id), String(r.status));
      return "authorization applied";
    }
    case "PAYMENT.AUTHORIZATION.VOIDED":
      await applyVoid(String(r.id));
      return "void applied";
    case "PAYMENT.CAPTURE.COMPLETED": {
      const allocationId = r.invoice_id ? String(r.invoice_id) : null;
      const alloc = allocationId
        ? await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) })
        : await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.paypalCaptureId, String(r.id)) });
      if (!alloc) return "no matching allocation";
      await applyCapture(alloc.id, String(r.id), String(r.status));
      await payoutAllocation(alloc.id);
      return "capture applied";
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      const captureId = (r.links as Array<{ rel: string; href: string }> | undefined)?.find((l) => l.rel === "up")?.href.split("/").pop();
      const alloc = captureId
        ? await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.paypalCaptureId, captureId) })
        : undefined;
      if (!alloc) return "no matching allocation";
      await applyRefund(alloc.id, String(r.id));
      return "refund applied";
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": {
      const allocationId = r.payout_item?.sender_item_id ? String(r.payout_item.sender_item_id) : null;
      if (!allocationId) return "no sender_item_id";
      const status = event.event_type.endsWith("SUCCEEDED") ? "succeeded" : event.event_type.endsWith("FAILED") ? "failed" : "unclaimed";
      const [p] = await db.update(schema.payouts).set({ status }).where(eq(schema.payouts.allocationId, allocationId)).returning();
      if (p) {
        const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, allocationId) });
        const order = alloc ? await db.query.orders.findFirst({ where: eq(schema.orders.id, alloc.orderId) }) : undefined;
        await emit("payout", { step: status, allocationId, netCents: p.netCents, payoutItemId: r.payout_item_id }, { rfqId: order?.rfqId, orderId: order?.id });
      }
      return `payout ${status}`;
    }
    default:
      return "ignored";
  }
}
