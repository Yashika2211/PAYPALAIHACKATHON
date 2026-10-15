import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { signingSecret } from "@/lib/firewall";
import { handle } from "@/lib/http";
import { signMandate } from "@/lib/policy/signature";

const Body = z.object({
  budgetCapCents: z.number().int().positive().max(10_000_000),
  allowedCategories: z.array(z.string()).min(1),
  allowedMerchantIds: z.array(z.string().uuid()).min(1),
  approvalThresholdCents: z.number().int().min(0),
  expiresInHours: z.number().int().min(1).max(24 * 30),
});

export async function POST(req: Request, ctx: RouteContext<"/api/rfqs/[id]/mandate">) {
  return handle(async () => {
    const { id: rfqId } = await ctx.params;
    const body = Body.parse(await req.json());
    const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, rfqId) });
    if (!rfq) throw new Error("Request not found");

    // A new signature supersedes any earlier mandate for this request.
    await db
      .update(schema.mandates)
      .set({ status: "revoked" })
      .where(and(eq(schema.mandates.rfqId, rfqId), eq(schema.mandates.status, "active")));

    const terms = {
      id: randomUUID(),
      buyerEmail: rfq.buyerEmail,
      budgetCapCents: body.budgetCapCents,
      allowedCategories: body.allowedCategories,
      allowedMerchantIds: body.allowedMerchantIds,
      approvalThresholdCents: body.approvalThresholdCents,
      expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000),
    };
    const signature = signMandate(terms, signingSecret());
    const [mandate] = await db
      .insert(schema.mandates)
      .values({ ...terms, rfqId, signedAt: new Date(), signature })
      .returning();
    await emit("mandate_signed", { mandateId: mandate.id, budgetCapCents: mandate.budgetCapCents, approvalThresholdCents: mandate.approvalThresholdCents }, { rfqId });
    return { mandateId: mandate.id };
  });
}
