import { describe, expect, it } from "vitest";
import { fallbackReply, minUnitPrice, selectLines, type CatalogEntry, type MerchantProfile } from "@/lib/agents/merchant-agent";
import { normalizeTags } from "@/lib/agents/catalog-extractor";

const item = (id: string, name: string, unit: string, list: number, tags: string[] = []): CatalogEntry => ({
  id,
  name,
  unit,
  listPriceCents: list,
  floorPriceCents: Math.round(list * 0.8),
  dietaryTags: normalizeTags(tags),
});

const tandoor = [
  item("samosa", "Samosa platter (24 pc)", "each", 3600, ["vegetarian"]),
  item("jamun", "Gulab jamun (dozen)", "per dozen", 1800, ["vegetarian"]),
  item("paneer", "Paneer tikka thali", "per person", 1450, ["vegetarian"]),
  item("chana", "Chana masala & jeera rice", "per person", 1200, ["vegan"]),
  item("butter", "Butter chicken thali", "per person", 1550),
  item("chai", "Masala chai service", "per person", 350),
];

const lunch = { category: "catering", description: "Lunch for 40 people", quantity: 40, vegetarianShare: 0.5 };

describe("selectLines", () => {
  it("serves per-person meals for a lunch, never platters or drinks", () => {
    const lines = selectLines(tandoor, [lunch]).map((l) => [l.item.id, l.quantity]);
    expect(lines).toEqual([
      ["chana", 20],
      ["butter", 20],
    ]);
  });

  it("treats vegan as vegetarian", () => {
    expect(normalizeTags(["Vegan", " vegan "])).toEqual(["vegan", "vegetarian"]);
  });

  it("serves an all-vegetarian need from vegetarian items only", () => {
    const lines = selectLines(tandoor, [{ ...lunch, vegetarianShare: 1 }]);
    expect(lines).toEqual([{ item: tandoor[3], quantity: 40 }]);
  });

  it("converts dozens and serves-N items for non-meal needs", () => {
    const bakery = [item("cookies", "Assorted vegan cookies", "per dozen", 2400, ["vegan"]), item("cake", "Celebration sheet cake (serves 40)", "each", 8500, ["vegan"])];
    expect(selectLines(bakery, [{ category: "bakery", description: "Cookies for 40", quantity: 40, vegetarianShare: 1 }])[0]).toEqual({ item: bakery[0], quantity: 4 });
    expect(selectLines(bakery, [{ category: "bakery", description: "Sheet cake", quantity: 80, vegetarianShare: 1 }])[0]).toEqual({ item: bakery[1], quantity: 2 });
  });

  it("concedes toward the counter but never below the private floor", () => {
    const merchant: MerchantProfile = { id: "t", name: "Tandoor", category: "catering", tagline: "", personality: "friendly", maxDiscountPct: 15, isRogue: false };
    const first = fallbackReply(merchant, tandoor, { rfqId: "r", round: 1, needs: [lunch], deadlineIso: null, previous: null, buyerCounterCents: null, buyerMessage: null });
    expect(first.totalCents).toBe(20 * 1200 + 20 * 1550);
    const second = fallbackReply(merchant, tandoor, { rfqId: "r", round: 2, needs: [lunch], deadlineIso: null, previous: first, buyerCounterCents: 1000, buyerMessage: "lower" });
    for (const l of second.lines) {
      expect(l.unitPriceCents).toBe(minUnitPrice(tandoor.find((t) => t.id === l.catalogItemId)!, 15));
    }
    expect(second.message).toMatch(/\$/);
  });
});
