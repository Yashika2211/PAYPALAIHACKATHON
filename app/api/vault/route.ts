import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/lib/db/client";
import { handle } from "@/lib/http";
import { forgetSavedMethod } from "@/lib/orders";

// Haggle's demo has a single sandbox buyer; a real deployment would key this on the signed-in user.
const buyer = () => process.env.SANDBOX_BUYER_EMAIL ?? "buyer@example.com";

export async function GET() {
  await connection();
  return handle(async () => {
    const saved = await db.query.buyerVault.findFirst({ where: eq(schema.buyerVault.buyerEmail, buyer()) });
    return { saved: saved ? { brand: saved.brand, lastDigits: saved.lastDigits, since: saved.createdAt } : null };
  });
}

export async function DELETE() {
  return handle(async () => {
    await forgetSavedMethod(buyer());
    return { saved: null };
  });
}
