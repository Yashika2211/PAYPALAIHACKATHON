import { z } from "zod";
import { structured } from "@/lib/llm/provider";

export const ExtractedItem = z.object({
  name: z.string().min(1),
  unit: z.string(),
  priceCents: z.number().int().positive(),
  dietaryTags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

export const Extraction = z.object({
  businessName: z.string().nullable(),
  category: z.string(),
  items: z.array(ExtractedItem),
});
export type Extraction = z.infer<typeof Extraction>;

export interface ExtractInput {
  text?: string;
  file?: { base64: string; mediaType: string };
  knownCategories: readonly string[];
}

const LINE = /^(.*?)(\.{2,}|\s[-–—:]\s|:\s|\s)\s*(\$)?\s?(\d{1,4}(?:\.\d{2})?)\s*(each|ea\.?|per person|pp|per dozen|dozen|per tray|per box|per piece)?\s*$/i;

/** Line-based parser for pasted price lists: "Name ...... $12.50 each". */
export function parsePriceText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = LINE.exec(line);
    if (!m) continue;
    const [, rawName, sep, dollar, amount, rawUnit] = m;
    // Needs a real price signal, so "Open 9-5" or phone numbers are skipped.
    const priced = Boolean(dollar) || amount.includes(".") || Boolean(rawUnit) || sep.trim().length > 0;
    const name = rawName.replace(/[.\-–—:·•\s]+$/u, "").replace(/^[-•*\s]+/, "").trim();
    if (!priced || name.length < 2 || !/[a-z]/i.test(name)) continue;
    const unit = (rawUnit ?? "each").toLowerCase().replace(/^pp$/, "per person").replace(/^ea\.?$/, "each").replace(/^dozen$/, "per dozen");
    const tags = new Set<string>();
    if (/\bvegan\b|\(vg\)/i.test(name)) tags.add("vegan").add("vegetarian");
    if (/\bvegetarian\b|\(v\)/i.test(name)) tags.add("vegetarian");
    if (/gluten[- ]free|\bgf\b/i.test(name)) tags.add("gluten-free");
    if (/\bhalal\b/i.test(name)) tags.add("halal");
    items.push({ name, unit, priceCents: Math.round(Number(amount) * 100), dietaryTags: [...tags], confidence: 0.6 });
  }
  return items;
}

/** Vision + structured output: menu photo, PDF or text in, typed catalog out. */
export async function extractCatalog(input: ExtractInput) {
  const system = [
    "You are Haggle's catalog extractor. Read a small business's menu, flyer or price list and return every sellable item.",
    "priceCents is the listed price in US cents. unit is how it's sold (each, per person, per dozen, per tray...).",
    "dietaryTags uses lowercase tags like vegetarian, vegan, gluten-free, halal when the menu indicates them (V, VG, GF symbols count).",
    "confidence is 0..1: lower it when the text is blurry, the price is ambiguous or you inferred the unit.",
    `category is one short lowercase word for the business type. Prefer one of: ${input.knownCategories.join(", ")}.`,
    "Skip headings, addresses, phone numbers and anything without a price.",
  ].join("\n");

  const content: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string }> = [
    { type: "text", text: input.text?.trim() ? `Price list text:\n${input.text}` : "Extract the catalog from this document." },
  ];
  if (input.file) content.push({ type: "file", data: input.file.base64, mediaType: input.file.mediaType });

  const fallbackItems = input.text ? parsePriceText(input.text) : [];
  return structured({
    tier: "smart",
    schema: Extraction,
    system,
    messages: [{ role: "user", content }],
    timeoutMs: 45_000,
    fallback: () => ({ businessName: null, category: input.knownCategories[0] ?? "catering", items: fallbackItems }),
  });
}
