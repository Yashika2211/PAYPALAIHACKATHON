import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { handle } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/rfqs/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, id) });
    if (!rfq) throw new Error("Request not found");
    const needs = rfq.lineItems as Array<{ category: string }>;
    const categories = [...new Set(needs.map((n) => n.category))];
    const merchants = categories.length
      ? await db.query.merchants.findMany({ where: inArray(schema.merchants.category, categories) })
      : [];
    const mandate = await db.query.mandates.findFirst({ where: eq(schema.mandates.rfqId, id), orderBy: desc(schema.mandates.createdAt) });
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.rfqId, id), orderBy: desc(schema.orders.createdAt) });
    const allocations = order
      ? await db.query.merchantAllocations.findMany({ where: eq(schema.merchantAllocations.orderId, order.id) })
      : [];
    const payouts = allocations.length
      ? await db.query.payouts.findMany({ where: inArray(schema.payouts.allocationId, allocations.map((a) => a.id)) })
      : [];
    return {
      rfq,
      merchants: merchants.map((m) => ({ id: m.id, name: m.name, category: m.category, tagline: m.tagline, status: m.status, personality: m.personality })),
      mandate: mandate && { ...mandate, signature: `${mandate.signature.slice(0, 12)}…` },
      order,
      allocations,
      payouts,
    };
  });
}
