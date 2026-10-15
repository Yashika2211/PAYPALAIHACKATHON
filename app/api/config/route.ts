import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
    demoBuyerEmail: process.env.SANDBOX_BUYER_EMAIL ?? "",
  });
}
