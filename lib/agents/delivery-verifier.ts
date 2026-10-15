import { z } from "zod";
import { structured } from "@/lib/llm/provider";

export const Verdict = z.object({
  pass: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type Verdict = z.infer<typeof Verdict> & { source: "llm" | "cache" | "fallback"; model?: string };

/** Minimum confidence for the system to capture without a human. */
export const AUTO_CAPTURE_CONFIDENCE = 0.7;

/**
 * Vision check of a fulfilment photo against what was ordered. It only informs
 * the capture decision: the firewall still requires deliveryVerified, and a human
 * can override either way.
 */
export async function verifyDelivery(args: { description: string; photo: { base64: string; mediaType: string }; cacheKey?: string }): Promise<Verdict> {
  const r = await structured({
    tier: "smart",
    schema: Verdict,
    system: [
      "You verify deliveries for Haggle, a marketplace that only pays merchants after delivery.",
      "Compare the photo with the order line. pass=true only if the photo plausibly shows the ordered goods in roughly the ordered form and quantity.",
      "Be strict about the wrong product, an empty or unrelated scene, or an obviously smaller quantity. Do not fail for lighting, angle or image style: judge what is shown, not whether it is a photograph (a person reviews disputes).",
      "reason: one short sentence a merchant and buyer can both read.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Order line: ${args.description}` },
          { type: "file", data: args.photo.base64, mediaType: args.photo.mediaType },
        ],
      },
    ],
    timeoutMs: 40_000,
    cacheKey: args.cacheKey,
    fallback: () => ({ pass: false, confidence: 0, reason: "Automatic photo check unavailable. A person needs to confirm delivery." }),
  });
  return { ...r.value, source: r.source, model: r.model };
}
