import { eq } from "drizzle-orm";
import { db, schema, sql } from "../lib/db/client";
import { planRequest } from "../lib/agents/buyer-agent";
import { merchantReply } from "../lib/agents/merchant-agent";
import { describeModel } from "../lib/llm/provider";

async function main() {
  console.log("models:", describeModel("fast"), "/", describeModel("smart"));
  const plan = await planRequest(
    "Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800.",
    ["catering", "bakery", "printing", "flowers"],
  );
  console.log("plan via", plan.source, JSON.stringify(plan.value, null, 1));
  const m = (await db.query.merchants.findFirst({ where: eq(schema.merchants.category, "catering") }))!;
  const catalog = await db.query.catalogItems.findMany({ where: eq(schema.catalogItems.merchantId, m.id) });
  const r = await merchantReply({ ...m }, catalog, { rfqId: "00000000-0000-0000-0000-000000000000", round: 1, needs: plan.value.needs.filter((n) => n.category === "catering"), deadlineIso: plan.value.deadlineIso, previous: null, buyerCounterCents: null, buyerMessage: null });
  console.log("merchant via", r.source, r.offer.totalCents, r.offer.lines.map((l) => `${l.quantity}x ${l.name} @${l.unitPriceCents}`), "|", r.offer.message, "| rejected:", r.rejectedAttempts);
  await sql.end();
}
main();
