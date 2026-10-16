import { paypalRequest } from "../lib/paypal/client";
import { SANDBOX_TEST_CARD, toValue } from "../lib/paypal/api";
import { sql } from "../lib/db/client";

/**
 * Sandbox only: tops up the platform account's PayPal balance (which funds merchant
 * Payouts) by charging PayPal's sandbox test card to it. Usage: pnpm sandbox:fund [dollars]
 */
async function main() {
  if (process.env.PAYPAL_ENV === "live") throw new Error("sandbox only");
  const cents = Math.round(Number(process.argv[2] ?? 2000) * 100);
  const order = await paypalRequest<{ id: string; status: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string }> } }> }>({
    method: "POST",
    path: "/v2/checkout/orders",
    body: {
      intent: "CAPTURE",
      purchase_units: [{ description: "Haggle sandbox platform top-up", amount: { currency_code: "USD", value: toValue(cents) } }],
      payment_source: { card: SANDBOX_TEST_CARD },
    },
  });
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  console.log(`top-up ${toValue(cents)} USD: order ${order.id} ${order.status}, capture ${capture?.id ?? "-"} ${capture?.status ?? ""}`);
  await sql.end();
}
main().catch(async (e) => {
  console.error(e.message, e.body ? JSON.stringify(e.body) : "");
  await sql.end();
  process.exit(1);
});
