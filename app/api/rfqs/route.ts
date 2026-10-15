import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { handle } from "@/lib/http";
import { planRequest } from "@/lib/agents/buyer-agent";

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as { request?: string };
    const text = body.request?.trim();
    if (!text || text.length < 8) throw new Error("Describe what you need in a sentence or two.");

    if (process.env.DEMO_MODE === "true") {
      // Each demo run starts with the rogue merchant back in the pool.
      await db.update(schema.merchants).set({ status: "live" }).where(eq(schema.merchants.isRogue, true));
    }
    const live = await db.query.merchants.findMany({ where: eq(schema.merchants.status, "live") });
    const categories = [...new Set(live.map((m) => m.category))];
    if (categories.length === 0) throw new Error("No merchants are live yet.");

    const { value: plan, source } = await planRequest(text, categories);
    const [rfq] = await db
      .insert(schema.rfqs)
      .values({
        buyerEmail: process.env.SANDBOX_BUYER_EMAIL ?? "buyer@example.com",
        rawRequest: text,
        lineItems: plan.needs,
        budgetHintCents: plan.budgetCents,
        deadline: plan.deadlineIso ? new Date(plan.deadlineIso) : null,
      })
      .returning();
    await emit("rfq_planned", { plan, source }, { rfqId: rfq.id });
    return { rfqId: rfq.id, plan, source };
  });
}
