import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { voidRemaining } from "@/lib/orders";

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
  return { expiredMandates: expired.length, staleHolds: stale.length, released };
}
