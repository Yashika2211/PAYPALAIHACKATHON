import { desc, eq, inArray } from "drizzle-orm";
import { planRequest } from "@/lib/agents/buyer-agent";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";

/** Turns a one-sentence request into a planned RFQ. Shared by the web app and the MCP server. */
export async function createRfq(text: string, opts: { source?: "web" | "mcp" } = {}) {
  const request = text.trim();
  if (request.length < 8) throw new Error("Describe what you need in a sentence or two.");

  if (process.env.DEMO_MODE === "true") {
    // Each demo run starts with the rogue merchant back in the pool.
    await db.update(schema.merchants).set({ status: "live" }).where(eq(schema.merchants.isRogue, true));
  }
  const live = await db.query.merchants.findMany({ where: eq(schema.merchants.status, "live") });
  const categories = [...new Set(live.map((m) => m.category))];
  if (categories.length === 0) throw new Error("No merchants are live yet.");

  const { value: plan, source } = await planRequest(request, categories);
  const [rfq] = await db
    .insert(schema.rfqs)
    .values({
      buyerEmail: process.env.SANDBOX_BUYER_EMAIL ?? "buyer@example.com",
      rawRequest: request,
      lineItems: plan.needs,
      budgetHintCents: plan.budgetCents,
      deadline: plan.deadlineIso ? new Date(plan.deadlineIso) : null,
    })
    .returning();
  await emit("rfq_planned", { plan, source, via: opts.source ?? "web" }, { rfqId: rfq.id });
  return { rfqId: rfq.id, plan, source };
}

/** Everything the buyer screens (and MCP clients) need about one request. */
export async function getSnapshot(id: string) {
  const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, id) });
  if (!rfq) throw new Error("Request not found");
  const needs = rfq.lineItems as Array<{ category: string }>;
  const categories = [...new Set(needs.map((n) => n.category))];
  const merchants = categories.length ? await db.query.merchants.findMany({ where: inArray(schema.merchants.category, categories) }) : [];
  const mandate = await db.query.mandates.findFirst({ where: eq(schema.mandates.rfqId, id), orderBy: desc(schema.mandates.createdAt) });
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.rfqId, id), orderBy: desc(schema.orders.createdAt) });
  const allocations = order ? await db.query.merchantAllocations.findMany({ where: eq(schema.merchantAllocations.orderId, order.id) }) : [];
  const payouts = allocations.length
    ? await db.query.payouts.findMany({ where: inArray(schema.payouts.allocationId, allocations.map((a) => a.id)) })
    : [];
  const vault = await db.query.buyerVault.findFirst({ where: eq(schema.buyerVault.buyerEmail, rfq.buyerEmail) });
  return {
    vault: vault ? { brand: vault.brand, lastDigits: vault.lastDigits } : null,
    rfq,
    merchants: merchants.map((m) => ({ id: m.id, name: m.name, category: m.category, tagline: m.tagline, status: m.status, personality: m.personality })),
    mandate: mandate && { ...mandate, signature: `${mandate.signature.slice(0, 12)}…` },
    order,
    allocations,
    payouts,
  };
}
