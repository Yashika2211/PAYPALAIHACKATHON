import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { emit } from "@/lib/events";
import { evaluate, type Action, type Actor, type FirewallResult, type MandateView } from "@/lib/policy/mandate-firewall";
import { verifyMandateSignature } from "@/lib/policy/signature";

export function signingSecret(): string {
  const secret = process.env.MANDATE_SIGNING_SECRET;
  if (!secret || secret === "change-me") throw new Error("MANDATE_SIGNING_SECRET must be set");
  return secret;
}

/** Loads the mandate straight from the database. This is the only source of spending authority. */
export async function loadMandate(mandateId: string | null) {
  if (!mandateId) return { view: null, signatureValid: false };
  const m = await db.query.mandates.findFirst({ where: eq(schema.mandates.id, mandateId) });
  if (!m) return { view: null, signatureValid: false };
  const signatureValid = verifyMandateSignature(m, m.signature, signingSecret());
  const view: MandateView = {
    id: m.id,
    status: m.status,
    budgetCapCents: m.budgetCapCents,
    spentCents: m.spentCents,
    allowedCategories: m.allowedCategories,
    allowedMerchantIds: m.allowedMerchantIds,
    approvalThresholdCents: m.approvalThresholdCents,
    expiresAt: m.expiresAt,
  };
  return { view, signatureValid };
}

async function quarantinedMerchantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.merchants.id })
    .from(schema.merchants)
    .where(eq(schema.merchants.status, "quarantined"));
  return rows.map((r) => r.id);
}

/**
 * Runs an action through the Mandate Firewall, records the decision, and applies
 * quarantine when asked. Every agent and payment action goes through here.
 */
export async function guard(args: {
  mandateId: string | null;
  rfqId: string | null;
  orderId?: string | null;
  actor: Actor;
  actorLabel: string;
  action: Action;
}): Promise<FirewallResult> {
  const { view, signatureValid } = await loadMandate(args.mandateId);
  const result = evaluate(view, args.action, {
    actor: args.actor,
    now: new Date(),
    signatureValid,
    quarantinedMerchantIds: await quarantinedMerchantIds(),
  });

  await db.insert(schema.firewallDecisions).values({
    mandateId: args.mandateId,
    rfqId: args.rfqId,
    actor: args.actorLabel,
    action: args.action,
    decision: result.decision,
    reasons: result.reasons,
    injectionFlags: result.injectionFlags,
  });
  await emit(
    "firewall",
    { actor: args.actorLabel, action: args.action.type, decision: result.decision, reasons: result.reasons, injectionFlags: result.injectionFlags },
    { rfqId: args.rfqId, orderId: args.orderId },
  );

  if (result.quarantineMerchantId) {
    await db
      .update(schema.merchants)
      .set({ status: "quarantined" })
      .where(eq(schema.merchants.id, result.quarantineMerchantId));
    await emit("quarantine", { merchantId: result.quarantineMerchantId, reasons: result.reasons }, { rfqId: args.rfqId });
  }
  return result;
}
