import { z } from "zod";

/** One priced line in an offer. Prices are integer cents. */
export const OfferLine = z.object({
  catalogItemId: z.string(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().positive(),
});
export type OfferLine = z.infer<typeof OfferLine>;

/** The typed negotiation message. Natural language rides along in `message`. */
export const Offer = z.object({
  rfqId: z.string(),
  merchantId: z.string(),
  round: z.number().int().min(1).max(4),
  lines: z.array(OfferLine).min(1),
  totalCents: z.number().int().positive(),
  validUntil: z.string().datetime(),
  terms: z.string().max(500),
  message: z.string().max(1000),
});
export type Offer = z.infer<typeof Offer>;

export const MAX_ROUNDS = 4;

export type OfferCheck = { ok: true; offer: Offer } | { ok: false; errors: string[] };

/**
 * Validates shape, recomputes the total from the lines (never trusting the LLM's
 * arithmetic) and enforces per-item floors that only the engine knows.
 */
export function checkOffer(raw: unknown, floors: ReadonlyMap<string, number>): OfferCheck {
  const parsed = Offer.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "offer"}: ${i.message}`) };
  }
  const offer = parsed.data;
  const errors: string[] = [];
  const computed = offer.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  if (computed !== offer.totalCents) {
    errors.push(`total ${offer.totalCents} does not match line items ${computed}`);
  }
  for (const line of offer.lines) {
    const floor = floors.get(line.catalogItemId);
    if (floor === undefined) errors.push(`unknown catalog item ${line.catalogItemId}`);
    else if (line.unitPriceCents < floor) errors.push(`${line.name} is priced below the merchant's floor`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, offer };
}
