import { desc } from "drizzle-orm";
import { connection } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { handle } from "@/lib/http";
import { structured } from "@/lib/llm/provider";

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().toLowerCase().min(2).max(30),
  tagline: z.string().trim().max(140).default(""),
  personality: z.enum(["friendly", "firm", "upsell"]),
  maxDiscountPct: z.number().int().min(0).max(50),
  leadTimeHours: z.number().int().min(1).max(336),
  dailyCapacity: z.number().int().min(1).max(10_000),
  payoutEmail: z.string().email(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        unit: z.string().trim().min(1).max(40),
        priceCents: z.number().int().positive().max(10_000_000),
        dietaryTags: z.array(z.string()).default([]),
        confidence: z.number().min(0).max(1).nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
});

export async function GET() {
  await connection();
  return handle(async () => {
    const merchants = await db.query.merchants.findMany({ orderBy: desc(schema.merchants.createdAt) });
    return { merchants: merchants.map(({ payoutEmail, ...m }) => ({ ...m, payoutEmail: payoutEmail.replace(/^(.{3}).*@/, "$1…@") })) };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const platform = process.env.SANDBOX_PLATFORM_EMAIL?.toLowerCase();
    if (platform && body.payoutEmail.toLowerCase() === platform) {
      throw new Error("That's Haggle's own PayPal account. Use the merchant's PayPal email for payouts.");
    }

    const [merchant] = await db
      .insert(schema.merchants)
      .values({
        name: body.name,
        category: body.category,
        tagline: body.tagline,
        personality: body.personality,
        maxDiscountPct: body.maxDiscountPct,
        leadTimeHours: body.leadTimeHours,
        dailyCapacity: body.dailyCapacity,
        payoutEmail: body.payoutEmail,
        status: "live",
      })
      .returning();
    await db.insert(schema.catalogItems).values(
      body.items.map((i) => ({
        merchantId: merchant.id,
        name: i.name,
        unit: i.unit,
        listPriceCents: i.priceCents,
        // Private floor derived from the guardrail. Never shown to any LLM.
        floorPriceCents: Math.ceil(i.priceCents * (1 - body.maxDiscountPct / 100)),
        category: body.category,
        dietaryTags: i.dietaryTags,
        leadTimeHours: body.leadTimeHours,
        extractionConfidence: i.confidence,
      })),
    );

    const voice = { friendly: "warm and accommodating", firm: "confident and quality-first", upsell: "enthusiastic and full of add-on ideas" }[body.personality];
    const greeting = await structured({
      tier: "fast",
      schema: z.object({ greeting: z.string() }),
      system: `You are the new AI sales agent for ${body.name}, a ${body.category} business. Personality: ${voice}. Write one sentence (max 25 words) introducing yourself to buyers' AI agents. No prices.`,
      prompt: `Signature items: ${body.items.slice(0, 4).map((i) => i.name).join(", ")}`,
      timeoutMs: 12_000,
      fallback: () => ({ greeting: `Hi, I'm the agent for ${body.name}. Tell me what you need and I'll put together a fair quote, day or night.` }),
    });
    return { merchantId: merchant.id, greeting: greeting.value.greeting, items: body.items.length };
  });
}
