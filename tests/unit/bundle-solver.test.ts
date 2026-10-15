import { describe, expect, it } from "vitest";
import { solveBundle, type CandidateOffer } from "@/lib/negotiation/bundle-solver";

const o = (offerId: string, merchantId: string, totalCents: number, categories: string[], firstQuoteCents = totalCents): CandidateOffer => ({
  offerId,
  merchantId,
  totalCents,
  firstQuoteCents,
  categories,
});

describe("solveBundle", () => {
  it("picks the cheapest covering set within budget", () => {
    const r = solveBundle(
      [o("a", "caterer", 50_000, ["catering"], 60_000), o("b", "printer", 8_000, ["printing"], 10_000), o("c", "rogue", 5_000, ["printing"])],
      ["catering", "printing"],
      80_000,
    );
    expect(r).toEqual({
      ok: true,
      bundle: expect.objectContaining({ totalCents: 55_000, firstQuoteTotalCents: 65_000, savingsCents: 10_000 }),
    });
    if (r.ok) expect(r.bundle.offers.map((x) => x.offerId).sort()).toEqual(["a", "c"]);
  });

  it("prefers fewer merchants on equal totals", () => {
    const r = solveBundle(
      [o("x", "m2", 6_000, ["catering"]), o("y", "m3", 4_000, ["bakery"]), o("combo", "m1", 10_000, ["catering", "bakery"])],
      ["catering", "bakery"],
      20_000,
    );
    expect(r.ok && r.bundle.offers.map((x) => x.offerId)).toEqual(["combo"]);
  });

  it("never uses two offers from the same merchant", () => {
    const r = solveBundle([o("a", "m1", 1, ["catering"]), o("b", "m1", 1, ["printing"])], ["catering", "printing"], 100);
    expect(r).toEqual({ ok: false, reason: "cannot_cover" });
  });

  it("reports over budget with the cheapest covering total", () => {
    expect(solveBundle([o("a", "m1", 900, ["catering"])], ["catering"], 800)).toEqual({
      ok: false,
      reason: "over_budget",
      cheapestCents: 900,
    });
  });

  it("handles no offers and refuses oversized searches", () => {
    expect(solveBundle([], ["catering"], 100)).toEqual({ ok: false, reason: "no_offers" });
    const many = Array.from({ length: 17 }, (_, i) => o(`o${i}`, `m${i}`, 1, ["x"]));
    expect(() => solveBundle(many, ["x"], 100)).toThrow("too many candidates");
  });
});
