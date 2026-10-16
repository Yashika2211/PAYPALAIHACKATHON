export {};

/**
 * Net-terms invoicing end to end against the real sandbox:
 * bundle → billing agent issues a PayPal invoice via the Agent Toolkit (firewall-wrapped)
 * → one merchant delivers before payment (no payout yet) → buyer pays
 * → the delivered merchant is paid out → the second delivers and is paid out.
 *
 * Usage: pnpm e2e:invoice [baseUrl]
 */
const BASE = process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose test client

async function call(path: string, body?: unknown, method = "POST"): Promise<Json> {
  const res = await fetch(BASE + path, body === undefined && method === "POST" ? undefined : { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${data.error ?? ""}`);
  return data;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  console.log(`Haggle invoice e2e against ${BASE}\n`);
  // A clean slate: without a saved method the agent can't auto-pay, so the buyer chooses invoicing.
  await call("/api/vault", undefined, "DELETE");

  console.log("1. Bundle");
  const { rfqId, plan } = await call("/api/rfqs", { request: "Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800." });
  let snap = await call(`/api/rfqs/${rfqId}`);
  await call(`/api/rfqs/${rfqId}/mandate`, {
    budgetCapCents: 80_000,
    approvalThresholdCents: 20_000,
    expiresInHours: 72,
    allowedCategories: [...new Set(plan.needs.map((n: Json) => n.category))],
    allowedMerchantIds: snap.merchants.map((m: Json) => m.id),
  });
  await call(`/api/rfqs/${rfqId}/negotiate`, {});
  for (let i = 0; i < 240 && !["bundled", "closed"].includes(snap.rfq.status); i++) {
    await wait(1000);
    snap = await call(`/api/rfqs/${rfqId}`);
  }
  check("bundle built", !!snap.order, snap.order ? `${usd(snap.order.totalCents)}, ${snap.allocations.length} merchants` : snap.rfq.status);

  console.log("\n2. Billing agent issues a PayPal invoice through the Agent Toolkit");
  const issued = await call(`/api/orders/${snap.order.id}/invoice`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("invoice created and sent", !!issued.invoiceId && snap.order.state === "invoiced", `${issued.invoiceId} by ${issued.agent ?? "deterministic fallback"}`);
  check("budget reserved by the open invoice", snap.mandate.spentCents === snap.order.totalCents, usd(snap.mandate.spentCents));
  const fw = (await call(`/api/rfqs/${rfqId}/events?after=0`)).events.filter((e: Json) => e.kind === "firewall" && String(e.payload.actor).startsWith("billing-agent"));
  check("every toolkit call passed the Mandate Firewall", fw.length > 0 && fw.every((e: Json) => e.payload.decision === "allow"), `${fw.length} decision(s)`);

  console.log("\n3. A merchant delivers before the invoice is paid");
  const [first, second] = snap.allocations;
  await call(`/api/allocations/${first.id}/deliver`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("delivery recorded, no payout yet", !!snap.allocations.find((a: Json) => a.id === first.id).deliveredAt && snap.payouts.length === 0);

  console.log("\n4. The buyer pays the invoice");
  const paid = await call(`/api/orders/${snap.order.id}/invoice/pay`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("invoice paid", ["PAID", "MARKED_AS_PAID"].includes(paid.status), paid.status);
  check("order settled", snap.order.state === "settled");
  check("delivered merchant paid out", snap.payouts.some((p: Json) => p.allocationId === first.id), usd(snap.payouts[0]?.netCents ?? 0));

  if (second) {
    console.log("\n5. The second merchant delivers after payment");
    await call(`/api/allocations/${second.id}/deliver`, {});
    snap = await call(`/api/rfqs/${rfqId}`);
    check("second merchant paid out", snap.payouts.some((p: Json) => p.allocationId === second.id));
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
