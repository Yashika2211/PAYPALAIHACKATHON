import { z } from "zod";
import { structured } from "@/lib/llm/provider";
import { formatUsd } from "@/lib/money";

export const Need = z.object({
  category: z.string(),
  description: z.string(),
  quantity: z.number().int().positive(),
  vegetarianShare: z.number().min(0).max(1),
});
export type Need = z.infer<typeof Need>;

export const Plan = z.object({
  summary: z.string(),
  headcount: z.number().int().positive(),
  budgetCents: z.number().int().positive().nullable(),
  deadlineIso: z.string().nullable(),
  needs: z.array(Need).min(1),
});
export type Plan = z.infer<typeof Plan>;

const KEYWORDS: Record<string, RegExp> = {
  catering: /\b(cater\w*|lunch|dinner|breakfast|food|meal|snacks?|buffet|coffee)\b/i,
  printing: /\b(print\w*|badges?|lanyards?|posters?|banners?|flyers?|programs?|signage)\b/i,
  bakery: /\b(bakery|cakes?|cookies?|cupcakes?|desserts?|pastr\w*|sweets)\b/i,
  flowers: /\b(flowers?|floral|florist|bouquets?|centerpieces?|arrangements?)\b/i,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextDeadline(text: string, now: Date): Date {
  const t = text.toLowerCase();
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (t.includes("tomorrow")) {
    d.setDate(d.getDate() + 1);
    return d;
  }
  const idx = WEEKDAYS.findIndex((w) => t.includes(w));
  if (idx >= 0) {
    const delta = (idx - now.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return d;
  }
  d.setDate(d.getDate() + 3);
  return d;
}

/** Deterministic planner used when no LLM is configured or it fails. */
export function fallbackPlan(text: string, categories: readonly string[], now = new Date()): Plan {
  const headcount = Number(/(\d+)\s*-?\s*(?:person|people|attendees|guests|pax|ppl)/i.exec(text)?.[1] ?? 20);
  const budgetMatch = /\$\s?([\d,]+(?:\.\d+)?)/.exec(text) ?? /([\d,]+)\s*(?:dollars|usd)/i.exec(text);
  const budgetCents = budgetMatch ? Math.round(Number(budgetMatch[1].replace(/,/g, "")) * 100) : null;

  let vegetarianShare = 0;
  const pct = /(\d+)\s*%\s*(?:veg|vegetarian|vegan)/i.exec(text);
  if (pct) vegetarianShare = Number(pct[1]) / 100;
  else if (/\b(all|fully|100%)\s+(veg|vegetarian|vegan)/i.test(text)) vegetarianShare = 1;
  else if (/\b(half|50%)\b.{0,20}\b(veg|vegetarian|vegan)/i.test(text)) vegetarianShare = 0.5;
  else if (/\b(veg|vegetarian|vegan)\b/i.test(text)) vegetarianShare = 0.5;

  const wanted = categories.filter((c) => KEYWORDS[c]?.test(text));
  const needs: Need[] = (wanted.length ? wanted : categories.slice(0, 1)).map((category) => {
    switch (category) {
      case "catering":
        return { category, description: `Lunch for ${headcount} people`, quantity: headcount, vegetarianShare };
      case "printing":
        return { category, description: `${headcount} printed name badges`, quantity: headcount, vegetarianShare: 0 };
      case "bakery":
        return { category, description: `Desserts for ${headcount} people`, quantity: headcount, vegetarianShare: 1 };
      case "flowers":
        return { category, description: "Table centerpieces", quantity: Math.ceil(headcount / 8), vegetarianShare: 0 };
      default:
        return { category, description: `${category} for ${headcount}`, quantity: headcount, vegetarianShare: 0 };
    }
  });

  return {
    summary: `${needs.map((n) => n.description).join(" + ")}${budgetCents ? `, under ${formatUsd(budgetCents)}` : ""}`,
    headcount,
    budgetCents,
    deadlineIso: nextDeadline(text, now).toISOString(),
    needs,
  };
}

export async function planRequest(text: string, categories: readonly string[], now = new Date()) {
  const schema = Plan.extend({
    needs: z.array(Need.extend({ category: z.enum(categories as [string, ...string[]]) })).min(1),
  });
  const result = await structured({
    tier: "smart",
    schema,
    system: [
      "You are Haggle's buyer procurement agent. Turn the buyer's request into a structured plan.",
      `Only use these merchant categories: ${categories.join(", ")}.`,
      "quantity is the number of units to buy: people served for food, items for print, arrangements for flowers.",
      "vegetarianShare is the minimum fraction (0..1) of food that must be vegetarian; 0 for non-food.",
      "budgetCents is the buyer's total budget in US cents, or null. deadlineIso is an ISO-8601 datetime, or null.",
      `Today is ${now.toDateString()}.`,
    ].join("\n"),
    prompt: text,
    fallback: () => fallbackPlan(text, categories, now),
  });
  return result;
}

/** Buyer's counter: push toward ~22% under the first quote, conceding as rounds pass. */
export function counterTotal(round: number, firstQuoteCents: number, lastOfferCents: number): number {
  const aim = Math.round(firstQuoteCents * 0.78);
  const step = [0, 0.86, 0.9, 0.95][Math.min(round - 1, 3)] ?? 0.95;
  return Math.max(aim, Math.round(lastOfferCents * step));
}

export function counterMessage(round: number, counterCents: number, merchantName: string): string {
  const name = merchantName.replace(/\.$/, "");
  const lines = [
    `Thanks ${name}. We're comparing several quotes. Could you do ${formatUsd(counterCents)} all-in?`,
    `Closer! Another vendor is below you. ${formatUsd(counterCents)} and we can likely sign today.`,
    `Final ask: ${formatUsd(counterCents)} and you're in the bundle.`,
  ];
  return lines[Math.min(round - 1, lines.length - 1)];
}

export async function writeRationale(args: {
  request: string;
  chosen: Array<{ merchant: string; totalCents: number; firstQuoteCents: number; items: string }>;
  rejected: Array<{ merchant: string; reason: string }>;
  totalCents: number;
  budgetCents: number;
}) {
  const fallback = () => {
    const saved = args.chosen.reduce((s, c) => s + c.firstQuoteCents - c.totalCents, 0);
    const parts = args.chosen.map((c) => `${c.merchant} (${c.items}) at ${formatUsd(c.totalCents)}`);
    const rejected = args.rejected.length ? ` Skipped: ${args.rejected.map((r) => `${r.merchant} (${r.reason})`).join("; ")}.` : "";
    return {
      rationale: `Best combination covering every need: ${parts.join(" + ")}. Total ${formatUsd(args.totalCents)}, ${formatUsd(args.budgetCents - args.totalCents)} under your cap, and ${formatUsd(saved)} below the first quotes.${rejected}`,
    };
  };
  const result = await structured({
    tier: "smart",
    schema: z.object({ rationale: z.string() }),
    system:
      "You are Haggle's buyer agent explaining a purchase decision that code already made. In 2-3 plain sentences, explain why this bundle was chosen, the savings, and why skipped vendors were skipped. Do not invent numbers; use only the ones given.",
    prompt: JSON.stringify(args),
    fallback,
  });
  return result.value.rationale;
}
