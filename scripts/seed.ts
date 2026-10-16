import { readFileSync } from "node:fs";
import { db, schema, sql } from "../lib/db/client";

// Floors are private to the negotiation engine and never shown to an LLM.
type SeedItem = [name: string, unit: string, listCents: number, floorCents: number, tags: string[]];

const platform = (process.env.SANDBOX_PLATFORM_EMAIL ?? "").trim().toLowerCase();
// Never pay the platform account itself: PayPal rejects it with SELF_PAY_NOT_ALLOWED.
const emails = (process.env.SANDBOX_MERCHANT_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter((e) => e && e.toLowerCase() !== platform);
const email = (i: number) => emails[i % Math.max(emails.length, 1)] ?? `merchant${i}@example.com`;

const MERCHANTS: Array<{
  name: string;
  category: string;
  tagline: string;
  personality: "friendly" | "firm" | "upsell";
  maxDiscountPct: number;
  leadTimeHours: number;
  isRogue?: boolean;
  payoutEmail: string;
  items: SeedItem[];
}> = [
  {
    name: "Saffron & Sage Catering",
    category: "catering",
    tagline: "Fresh Mediterranean lunches for teams of 10 to 200.",
    personality: "friendly",
    maxDiscountPct: 20,
    leadTimeHours: 24,
    payoutEmail: email(0),
    items: [
      ["Vegetarian falafel lunch box", "per person", 1600, 1250, ["vegetarian"]],
      ["Vegan roasted veg grain bowl", "per person", 1700, 1300, ["vegan", "vegetarian"]],
      ["Chicken shawarma lunch box", "per person", 1800, 1400, []],
      ["Coffee & tea service", "per person", 400, 280, ["vegan", "vegetarian"]],
    ],
  },
  {
    name: "Rise Vegan Bakery",
    category: "bakery",
    tagline: "100% plant-based treats, baked at 5am every day.",
    personality: "upsell",
    maxDiscountPct: 15,
    leadTimeHours: 36,
    payoutEmail: email(1),
    items: [
      ["Assorted vegan cookies", "per dozen", 2400, 1700, ["vegan", "vegetarian"]],
      ["Vegan chocolate cupcakes", "per dozen", 3600, 2600, ["vegan", "vegetarian"]],
      ["Celebration sheet cake (serves 40)", "each", 8500, 6200, ["vegan", "vegetarian"]],
    ],
  },
  {
    name: "Inkwell Print Co.",
    category: "printing",
    tagline: "Same-week print for events: badges, posters, programs.",
    personality: "firm",
    maxDiscountPct: 12,
    leadTimeHours: 48,
    payoutEmail: email(2),
    items: [
      ["Printed name badges with lanyards", "each", 350, 240, []],
      ["A1 foam-board poster", "each", 4500, 3200, []],
      ["Tri-fold program booklet", "each", 120, 80, []],
    ],
  },
  {
    name: "Petal Post Florist",
    category: "flowers",
    tagline: "Seasonal arrangements, delivered same day.",
    personality: "upsell",
    maxDiscountPct: 15,
    leadTimeHours: 24,
    payoutEmail: email(3),
    items: [
      ["Table centerpiece", "each", 3800, 2700, []],
      ["Welcome desk arrangement", "each", 7500, 5500, []],
    ],
  },
  {
    name: "QuickPrint Pro",
    category: "printing",
    tagline: "Cheapest badges in town. Fast.",
    personality: "friendly",
    maxDiscountPct: 30,
    leadTimeHours: 24,
    isRogue: true,
    payoutEmail: email(2),
    items: [
      ["Name badges", "each", 190, 150, []],
      ["Posters", "each", 3000, 2200, []],
    ],
  },
];

async function main() {
  const reset = process.argv.includes("--reset");
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from merchants`;
  if (count > 0 && !reset) {
    console.log(`already seeded (${count} merchants); pass --reset to wipe demo data and reseed`);
    await sql.end();
    return;
  }
  // Wipes demo data only; real PayPal records stay in PayPal.
  await sql`TRUNCATE merchants, rfqs, paypal_events, paypal_api_calls, firewall_decisions, events RESTART IDENTITY CASCADE`;

  for (const m of MERCHANTS) {
    const [merchant] = await db
      .insert(schema.merchants)
      .values({
        name: m.name,
        category: m.category,
        tagline: m.tagline,
        personality: m.personality,
        payoutEmail: m.payoutEmail,
        maxDiscountPct: m.maxDiscountPct,
        leadTimeHours: m.leadTimeHours,
        isRogue: m.isRogue ?? false,
        status: "live",
      })
      .returning();
    await db.insert(schema.catalogItems).values(
      m.items.map(([name, unit, listPriceCents, floorPriceCents, dietaryTags]) => ({
        merchantId: merchant.id,
        name,
        unit,
        listPriceCents,
        floorPriceCents,
        dietaryTags,
        category: m.category,
        leadTimeHours: m.leadTimeHours,
        extractionConfidence: 1,
      })),
    );
    console.log(`seeded ${m.name}${m.isRogue ? " (rogue)" : ""} -> payouts to ${m.payoutEmail}`);
  }

  // Real AI answers for the bundled demo samples, replayed only if live AI is unavailable.
  const cached = JSON.parse(readFileSync("scripts/fixtures/llm-cache.json", "utf8")) as Array<{ key: string; value: object; model: string }>;
  for (const c of cached) {
    await db.insert(schema.llmCache).values(c).onConflictDoNothing();
  }
  if (cached.length) console.log(`loaded ${cached.length} cached AI answer(s) for demo samples`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
