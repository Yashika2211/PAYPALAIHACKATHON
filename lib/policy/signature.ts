import { createHmac, timingSafeEqual } from "node:crypto";

export interface MandateTerms {
  id: string;
  buyerEmail: string;
  budgetCapCents: number;
  allowedCategories: readonly string[];
  allowedMerchantIds: readonly string[];
  approvalThresholdCents: number;
  expiresAt: Date;
}

/** Canonical, order-independent serialization of the signed terms. */
export function canonicalTerms(t: MandateTerms): string {
  return JSON.stringify({
    id: t.id,
    buyerEmail: t.buyerEmail.toLowerCase(),
    budgetCapCents: t.budgetCapCents,
    allowedCategories: [...t.allowedCategories].sort(),
    allowedMerchantIds: [...t.allowedMerchantIds].sort(),
    approvalThresholdCents: t.approvalThresholdCents,
    expiresAt: t.expiresAt.toISOString(),
  });
}

export function signMandate(terms: MandateTerms, secret: string): string {
  return createHmac("sha256", secret).update(canonicalTerms(terms)).digest("hex");
}

export function verifyMandateSignature(terms: MandateTerms, signature: string, secret: string): boolean {
  const expected = Buffer.from(signMandate(terms, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
