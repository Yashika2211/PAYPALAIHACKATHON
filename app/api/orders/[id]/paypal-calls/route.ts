import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { handle } from "@/lib/http";

/** Raw PayPal requests/responses for one order, already redacted at write time. */
export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]/paypal-calls">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const calls = await db.query.paypalApiCalls.findMany({
      where: eq(schema.paypalApiCalls.orderId, id),
      orderBy: asc(schema.paypalApiCalls.createdAt),
    });
    return { calls };
  });
}
