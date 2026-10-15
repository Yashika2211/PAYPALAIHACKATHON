import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema, sql } from "../lib/db/client";
import { voidRemaining } from "../lib/orders";

/**
 * Scheduled job (Render cron): expires lapsed mandates and releases PayPal holds
 * that have waited too long for delivery, so buyers are never left with stale holds.
 * PayPal's authorization honor period is 3 days; we void after STALE_HOLD_DAYS.
 */
const STALE_HOLD_DAYS = Number(process.env.STALE_HOLD_DAYS ?? 3);

async function main() {
  const now = new Date();
  const expired = await db
    .update(schema.mandates)
    .set({ status: "expired" })
    .where(and(eq(schema.mandates.status, "active"), lt(schema.mandates.expiresAt, now)))
    .returning({ id: schema.mandates.id });
  console.log(`expired ${expired.length} mandate(s)`);

  const cutoff = new Date(now.getTime() - STALE_HOLD_DAYS * 86_400_000);
  const stale = await db.query.orders.findMany({
    where: and(inArray(schema.orders.state, ["authorized", "partially_captured"]), lt(schema.orders.updatedAt, cutoff)),
  });
  for (const order of stale) {
    try {
      await voidRemaining(order.id);
      console.log(`released hold on order ${order.id}`);
    } catch (err) {
      console.error(`could not release ${order.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`checked ${stale.length} stale hold(s)`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
