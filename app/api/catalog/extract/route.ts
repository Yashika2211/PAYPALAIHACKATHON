import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { extractCatalog } from "@/lib/agents/catalog-extractor";
import { handle } from "@/lib/http";
import { limit } from "@/lib/rate-limit";

const Body = z.object({
  text: z.string().max(20_000).optional(),
  file: z
    .object({
      base64: z.string().max(12_000_000),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    })
    .optional(),
  sampleId: z.enum(["menu"]).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    limit(req, "extract");
    const body = Body.parse(await req.json());
    if (!body.text?.trim() && !body.file) throw new Error("Upload a menu photo or PDF, or paste your price list.");
    const live = await db.selectDistinct({ category: schema.merchants.category }).from(schema.merchants).where(eq(schema.merchants.status, "live"));
    const known = [...new Set(["catering", "bakery", "printing", "flowers", ...live.map((r) => r.category)])];
    const result = await extractCatalog({
      text: body.text,
      file: body.file,
      knownCategories: known,
      cacheKey: body.sampleId ? `extract:sample:${body.sampleId}` : undefined,
    });
    if (result.value.items.length === 0) {
      throw new Error(result.source === "fallback" ? "AI is busy and the text had no recognizable prices. Try again or paste lines like “Veg wrap ... $9.50 each”." : "No priced items found. Try a clearer photo.");
    }
    return { ...result.value, source: result.source, model: result.model ?? null };
  });
}
