import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { guard, loadMandate } from "@/lib/firewall";
import { counterMessage, counterTotal, writeRationale, type Plan } from "@/lib/agents/buyer-agent";
import { merchantReply, type CatalogEntry, type MerchantProfile } from "@/lib/agents/merchant-agent";
import { MAX_ROUNDS, type Offer } from "@/lib/agents/protocol";
import { solveBundle, type CandidateOffer } from "./bundle-solver";
import { transition } from "@/lib/state/order-machine";
import { autoApprove } from "@/lib/orders";

interface NegotiationOutcome {
  merchant: MerchantProfile;
  finalOffer: Offer;
  finalOfferRowId: string;
  firstQuoteCents: number;
}

type Blocked = { merchant: MerchantProfile; reason: string };

async function negotiateWith(
  rfq: typeof schema.rfqs.$inferSelect,
  plan: Plan,
  mandateId: string,
  merchant: MerchantProfile,
  catalog: CatalogEntry[],
): Promise<NegotiationOutcome | Blocked> {
  const needs = plan.needs.filter((n) => n.category === merchant.category);
  const [neg] = await db
    .insert(schema.negotiations)
    .values({ rfqId: rfq.id, merchantId: merchant.id })
    .returning();
  const ids = { rfqId: rfq.id };

  const rfqCheck = await guard({
    mandateId,
    rfqId: rfq.id,
    actor: "buyer_agent",
    actorLabel: "buyer-agent",
    action: { type: "send_rfq", merchantId: merchant.id, category: merchant.category },
  });
  if (rfqCheck.decision !== "allow") {
    await db.update(schema.negotiations).set({ status: "rejected" }).where(eq(schema.negotiations.id, neg.id));
    return { merchant, reason: rfqCheck.reasons.join("; ") };
  }
  await emit("rfq_sent", { merchantId: merchant.id, merchant: merchant.name, needs }, ids);

  let previous: Offer | null = null;
  let first: Offer | null = null;
  let counter: number | null = null;
  let buyerMessage: string | null = null;
  let finalRowId = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await merchantReply(merchant, catalog, {
      rfqId: rfq.id,
      round,
      needs,
      deadlineIso: plan.deadlineIso,
      previous,
      buyerCounterCents: counter,
      buyerMessage,
    });
    const offer = reply.offer;
    const [row] = await db
      .insert(schema.offers)
      .values({
        negotiationId: neg.id,
        round,
        side: "merchant",
        payload: offer,
        totalCents: offer.totalCents,
        message: offer.message,
        rawLlmOutput: reply.raw,
      })
      .returning();

    if (reply.rejectedAttempts.length) {
      await emit("offer_rejected", { merchantId: merchant.id, merchant: merchant.name, round, errors: reply.rejectedAttempts }, ids);
    }

    const check = await guard({
      mandateId,
      rfqId: rfq.id,
      actor: "merchant_agent",
      actorLabel: `merchant-agent:${merchant.name}`,
      action: { type: "propose_offer", merchantId: merchant.id, totalCents: offer.totalCents, message: offer.message },
    });
    await emit(
      "offer",
      {
        merchantId: merchant.id,
        merchant: merchant.name,
        round,
        totalCents: offer.totalCents,
        message: offer.message,
        lines: offer.lines,
        source: reply.source,
        blocked: check.decision === "deny",
      },
      ids,
    );
    if (check.decision === "deny") {
      const status = check.quarantineMerchantId ? "quarantined" : "rejected";
      await db.update(schema.negotiations).set({ status, roundCount: round }).where(eq(schema.negotiations.id, neg.id));
      await emit("negotiation_done", { merchantId: merchant.id, merchant: merchant.name, status }, ids);
      return { merchant, reason: status === "quarantined" ? "blocked by the Mandate Firewall (prompt injection)" : check.reasons.join("; ") };
    }

    first ??= offer;
    finalRowId = row.id;
    const reachedCounter = counter !== null && offer.totalCents <= Math.round(counter * 1.01);
    const stalled = previous !== null && offer.totalCents >= previous.totalCents;
    if (reachedCounter || stalled || round === MAX_ROUNDS) {
      previous = offer;
      break;
    }

    counter = counterTotal(round, first.totalCents, offer.totalCents);
    buyerMessage = counterMessage(round, counter, merchant.name);
    await guard({
      mandateId,
      rfqId: rfq.id,
      actor: "buyer_agent",
      actorLabel: "buyer-agent",
      action: { type: "counter_offer", merchantId: merchant.id, totalCents: counter },
    });
    await db.insert(schema.offers).values({
      negotiationId: neg.id,
      round,
      side: "buyer",
      payload: { counterTotalCents: counter },
      totalCents: counter,
      message: buyerMessage,
    });
    await emit("counter", { merchantId: merchant.id, merchant: merchant.name, round, totalCents: counter, message: buyerMessage }, ids);
    previous = offer;
  }

  await db
    .update(schema.negotiations)
    .set({ status: "accepted", roundCount: previous!.round })
    .where(eq(schema.negotiations.id, neg.id));
  await emit("negotiation_done", { merchantId: merchant.id, merchant: merchant.name, status: "accepted", totalCents: previous!.totalCents }, ids);
  return { merchant, finalOffer: previous!, finalOfferRowId: finalRowId, firstQuoteCents: first!.totalCents };
}

/** Runs every merchant negotiation in parallel, then builds and persists the best bundle. */
export async function runNegotiation(rfqId: string) {
  const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, rfqId) });
  if (!rfq) throw new Error("RFQ not found");
  const mandate = await db.query.mandates.findFirst({
    where: and(eq(schema.mandates.rfqId, rfqId), eq(schema.mandates.status, "active")),
    orderBy: desc(schema.mandates.createdAt),
  });
  if (!mandate) throw new Error("Sign a mandate before negotiating");

  const plan: Plan = {
    summary: "",
    headcount: 0,
    budgetCents: rfq.budgetHintCents,
    deadlineIso: rfq.deadline?.toISOString() ?? null,
    needs: rfq.lineItems as Plan["needs"],
  };
  const categories = [...new Set(plan.needs.map((n) => n.category))];

  const merchants = await db.query.merchants.findMany({
    where: and(inArray(schema.merchants.category, categories), eq(schema.merchants.status, "live")),
  });
  const catalogRows = merchants.length
    ? await db.query.catalogItems.findMany({ where: inArray(schema.catalogItems.merchantId, merchants.map((m) => m.id)) })
    : [];

  await db.update(schema.rfqs).set({ status: "negotiating" }).where(eq(schema.rfqs.id, rfqId));

  const outcomes = await Promise.all(
    merchants.map((m) =>
      negotiateWith(
        rfq,
        plan,
        mandate.id,
        { id: m.id, name: m.name, category: m.category, tagline: m.tagline, personality: m.personality, maxDiscountPct: m.maxDiscountPct, isRogue: m.isRogue },
        catalogRows.filter((c) => c.merchantId === m.id),
      ).catch((err): Blocked => ({ merchant: { id: m.id, name: m.name } as MerchantProfile, reason: `error: ${String(err).slice(0, 120)}` })),
    ),
  );

  const done = outcomes.filter((o): o is NegotiationOutcome => "finalOffer" in o);
  const blocked = outcomes.filter((o): o is Blocked => "reason" in o);

  const { view } = await loadMandate(mandate.id);
  const budget = view ? view.budgetCapCents - view.spentCents : 0;
  const candidates: CandidateOffer[] = done.map((o) => ({
    offerId: o.finalOfferRowId,
    merchantId: o.merchant.id,
    totalCents: o.finalOffer.totalCents,
    firstQuoteCents: o.firstQuoteCents,
    categories: [o.merchant.category],
  }));
  const solved = solveBundle(candidates, categories, budget);
  if (!solved.ok) {
    await db.update(schema.rfqs).set({ status: "closed" }).where(eq(schema.rfqs.id, rfqId));
    await emit("bundle_failed", { reason: solved.reason, cheapestCents: solved.cheapestCents ?? null }, { rfqId });
    return { ok: false as const, reason: solved.reason };
  }

  const chosen = solved.bundle.offers.map((c) => done.find((d) => d.finalOfferRowId === c.offerId)!);
  for (const c of chosen) {
    const r = await guard({
      mandateId: mandate.id,
      rfqId,
      actor: "buyer_agent",
      actorLabel: "buyer-agent",
      action: { type: "accept_offer", merchantId: c.merchant.id, category: c.merchant.category, totalCents: c.finalOffer.totalCents },
    });
    if (r.decision === "deny") {
      await emit("bundle_failed", { reason: r.reasons.join("; ") }, { rfqId });
      return { ok: false as const, reason: "firewall_denied" };
    }
  }

  const notChosen = done
    .filter((d) => !chosen.includes(d))
    .map((d) => ({ merchant: d.merchant.name, reason: `more expensive for the same need (${(d.finalOffer.totalCents / 100).toFixed(2)})` }));
  const rationale = await writeRationale({
    request: rfq.rawRequest,
    chosen: chosen.map((c) => ({
      merchant: c.merchant.name,
      totalCents: c.finalOffer.totalCents,
      firstQuoteCents: c.firstQuoteCents,
      items: c.finalOffer.lines.map((l) => `${l.quantity}× ${l.name}`).join(", "),
    })),
    rejected: [...blocked.map((b) => ({ merchant: b.merchant.name, reason: b.reason })), ...notChosen],
    totalCents: solved.bundle.totalCents,
    budgetCents: budget,
  });

  let state = transition("draft", "quoted");
  state = transition(state, "mandate_signed");
  const [order] = await db
    .insert(schema.orders)
    .values({
      rfqId,
      mandateId: mandate.id,
      state,
      totalCents: solved.bundle.totalCents,
      firstQuoteTotalCents: solved.bundle.firstQuoteTotalCents,
      rationale,
    })
    .returning();
  await db.insert(schema.merchantAllocations).values(
    chosen.map((c) => ({
      orderId: order.id,
      merchantId: c.merchant.id,
      offerId: c.finalOfferRowId,
      amountCents: c.finalOffer.totalCents,
      description: `${c.merchant.name}: ${c.finalOffer.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}`,
    })),
  );
  await db.update(schema.rfqs).set({ status: "bundled" }).where(eq(schema.rfqs.id, rfqId));
  await emit(
    "bundle_ready",
    { orderId: order.id, totalCents: order.totalCents, firstQuoteTotalCents: order.firstQuoteTotalCents, rationale },
    { rfqId, orderId: order.id },
  );

  // With a saved PayPal Vault method, the agent pays on its own, but only if the firewall
  // allows it (at or under the mandate's auto-approve threshold). Otherwise it waits for the buyer.
  try {
    await autoApprove(order.id);
  } catch (err) {
    await emit("approval_needed", { reasons: [`Agent payment failed: ${err instanceof Error ? err.message : String(err)}`], totalCents: order.totalCents }, { rfqId, orderId: order.id });
  }
  return { ok: true as const, orderId: order.id };
}
