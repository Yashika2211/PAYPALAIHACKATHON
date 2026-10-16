import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { isRetryablePayoutFailure, payoutAllocation, processWebhookEvent, retryPayout, voidRemaining } from "@/lib/orders";
import { getPayoutBatch } from "@/lib/paypal/api";

/** PayPal's authorization honor period is 3 days; holds older than this are released. */
const STALE_HOLD_DAYS = Number(process.env.STALE_HOLD_DAYS ?? 3);

/** Expires lapsed mandates and releases PayPal holds that waited too long for delivery. */
export async function expireAndRelease(now = new Date()) {
  const expired = await db
    .update(schema.mandates)
    .set({ status: "expired" })
    .where(and(eq(schema.mandates.status, "active"), lt(schema.mandates.expiresAt, now)))
    .returning({ id: schema.mandates.id });

  const cutoff = new Date(now.getTime() - STALE_HOLD_DAYS * 86_400_000);
  const stale = await db.query.orders.findMany({
    where: and(inArray(schema.orders.state, ["authorized", "partially_captured"]), lt(schema.orders.updatedAt, cutoff)),
  });
  let released = 0;
  for (const order of stale) {
    try {
      await voidRemaining(order.id);
      released++;
    } catch (err) {
      console.error(`[maintenance] could not release ${order.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Payouts that failed for transient reasons (e.g. platform balance) are retried, up to 5 attempts.
  const failed = await db.query.payouts.findMany({ where: and(eq(schema.payouts.status, "failed"), lt(schema.payouts.attempts, 5)) });
  let retried = 0;
  for (const p of failed.filter((f) => isRetryablePayoutFailure(f.failureReason))) {
    try {
      await retryPayout(p.allocationId);
      retried++;
    } catch {
      /* recorded on the payout row; next sweep tries again */
    }
  }
  // Payouts that never reached PayPal (e.g. the process stopped mid-request) are sent now.
  const unsent = await db.query.payouts.findMany({
    where: and(eq(schema.payouts.status, "pending"), isNull(schema.payouts.payoutBatchId), lt(schema.payouts.updatedAt, new Date(now.getTime() - 5 * 60_000))),
  });
  for (const p of unsent) {
    await payoutAllocation(p.allocationId);
    retried++;
  }
  // Reconcile payouts whose webhook never arrived (e.g. the endpoint was down): ask PayPal directly.
  const waiting = await db.query.payouts.findMany({
    where: and(eq(schema.payouts.status, "pending"), lt(schema.payouts.updatedAt, new Date(now.getTime() - 10 * 60_000))),
  });
  let reconciled = 0;
  for (const p of waiting.filter((w) => w.payoutBatchId)) {
    try {
      const batch = await getPayoutBatch(p.payoutBatchId!);
      const item = batch.items?.find((i) => i.payout_item.sender_item_id === p.allocationId);
      const status = item?.transaction_status;
      const kind = status === "SUCCESS" ? "SUCCEEDED" : status === "FAILED" || status === "RETURNED" || status === "BLOCKED" ? "FAILED" : status === "UNCLAIMED" ? "UNCLAIMED" : null;
      if (!kind || !item) continue;
      // Same idempotent code path as the webhook.
      await processWebhookEvent({
        id: `reconcile-${item.payout_item_id}`,
        event_type: `PAYMENT.PAYOUTS-ITEM.${kind}`,
        resource: { ...(item as unknown as Record<string, unknown>), id: item.payout_item_id },
      });
      reconciled++;
    } catch (err) {
      console.error(`[maintenance] reconcile ${p.payoutBatchId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { expiredMandates: expired.length, staleHolds: stale.length, released, payoutsRetried: retried, payoutsReconciled: reconciled };
}
