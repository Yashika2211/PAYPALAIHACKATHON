import { describe, expect, it } from "vitest";
import { parsePriceText } from "@/lib/agents/catalog-extractor";

describe("parsePriceText", () => {
  it("parses common price list lines", () => {
    const items = parsePriceText(`SAFFRON KITCHEN
Call 555-0100
Falafel wrap (V) ........ $9.50 each
Vegan grain bowl, GF - 12 per person
Baklava tray: $24.00 per tray`);
    expect(items.map((i) => [i.name, i.priceCents, i.unit])).toEqual([
      ["Falafel wrap (V)", 950, "each"],
      ["Vegan grain bowl, GF", 1200, "per person"],
      ["Baklava tray", 2400, "per tray"],
    ]);
    expect(items[1].dietaryTags).toEqual(expect.arrayContaining(["vegan", "gluten-free"]));
  });

  it("ignores lines without a price", () => {
    expect(parsePriceText("Open daily 9-5\nCatering available")).toEqual([]);
  });
});
