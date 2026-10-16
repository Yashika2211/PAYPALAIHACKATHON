import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { AUTO_CAPTURE_CONFIDENCE, verifyDelivery } from "@/lib/agents/delivery-verifier";
import { emit } from "@/lib/events";
import { handle } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { deliver } from "@/lib/orders";

const Body = z.object({
  photo: z.object({ base64: z.string().max(8_000_000), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]) }),
  thumbnail: z.string().max(400_000).optional(),
  sampleId: z.enum(["badges", "lunch", "tandoor", "short"]).optional(),
});

/** Merchant uploads a fulfilment photo; the AI check decides whether the system may capture on its own. */
export async function POST(req: Request, ctx: RouteContext<"/api/allocations/[id]/verify">) {
  return handle(async () => {
    limit(req, "verify");
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());
    const alloc = await db.query.merchantAllocations.findFirst({ where: eq(schema.merchantAllocations.id, id) });
    if (!alloc) throw new Error("Order line not found");
    if (alloc.deliveredAt || !["authorized", "pending", "captured"].includes(alloc.state)) throw new Error(`This line is already ${alloc.deliveredAt ? "delivered" : alloc.state}`);

    const verdict = await verifyDelivery({
      description: alloc.description,
      photo: body.photo,
      // Bundled demo photos re-encode differently per browser, so key them by name.
      cacheKey: body.sampleId ? `verify:sample:${body.sampleId}:${alloc.description}` : undefined,
    });
    await db
      .update(schema.merchantAllocations)
      .set({ verifierResult: verdict, deliveryPhotoUrl: body.thumbnail ?? null })
      .where(eq(schema.merchantAllocations.id, id));
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, alloc.orderId) });
    await emit("delivery", { allocationId: id, pass: verdict.pass, confidence: verdict.confidence, reason: verdict.reason, source: verdict.source }, { rfqId: order?.rfqId, orderId: alloc.orderId });

    const autoCapture = verdict.pass && verdict.confidence >= AUTO_CAPTURE_CONFIDENCE;
    if (autoCapture) await deliver(id, { actor: "system", deliveryVerified: true });
    return { verdict, captured: autoCapture };
  });
}
