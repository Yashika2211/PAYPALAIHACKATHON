import { describe, expect, it } from "vitest";
import { checkOffer } from "@/lib/agents/protocol";

const floors = new Map([
  ["wrap", 700],
  ["badge", 150],
]);

const offer = (over: Record<string, unknown> = {}) => ({
  rfqId: "r1",
  merchantId: "caterer",
  round: 1,
  lines: [
    { catalogItemId: "wrap", name: "Veggie wrap", quantity: 40, unitPriceCents: 900 },
    { catalogItemId: "badge", name: "Name badge", quantity: 40, unitPriceCents: 200 },
  ],
  totalCents: 44_000,
  validUntil: "2026-11-05T00:00:00.000Z",
  terms: "Delivery included",
  message: "Here's our quote",
  ...over,
});

describe("checkOffer", () => {
  it("accepts a valid offer", () => {
    const r = checkOffer(offer(), floors);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed offers with readable errors", () => {
    const r = checkOffer(offer({ round: 9, lines: [] }), floors);
    expect(r).toEqual({ ok: false, errors: expect.arrayContaining([expect.stringContaining("round")]) });
    const empty = checkOffer(null, floors);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]).toMatch(/^offer:/);
  });

  it("recomputes the total instead of trusting the model", () => {
    const r = checkOffer(offer({ totalCents: 30_000 }), floors);
    expect(r).toEqual({ ok: false, errors: ["total 30000 does not match line items 44000"] });
  });

  it("enforces floors and unknown items", () => {
    const r = checkOffer(
      offer({
        lines: [
          { catalogItemId: "wrap", name: "Veggie wrap", quantity: 1, unitPriceCents: 500 },
          { catalogItemId: "cake", name: "Cake", quantity: 1, unitPriceCents: 100 },
        ],
        totalCents: 600,
      }),
      floors,
    );
    expect(r).toEqual({
      ok: false,
      errors: ["Veggie wrap is priced below the merchant's floor", "unknown catalog item cake"],
    });
  });
});
