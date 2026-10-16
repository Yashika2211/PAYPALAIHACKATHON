/**
 * PayPal Vault + mandate threshold, end to end against the real sandbox:
 *  1. a purchase paid with the sandbox card, saved to PayPal Vault for the agent
 *  2. a small purchase under the auto-approve threshold → the agent pays on its own
 *  3. a large purchase over the threshold → the firewall makes the agent ask the buyer
 *
 * Usage: pnpm e2e:vault [baseUrl]
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

/** request → mandate (cap, threshold) → negotiation; returns the snapshot once the bundle exists. */
async function buy(request: string, capCents: number, thresholdCents: number) {
  const { rfqId, plan } = await call("/api/rfqs", { request });
  let snap = await call(`/api/rfqs/${rfqId}`);
  await call(`/api/rfqs/${rfqId}/mandate`, {
    budgetCapCents: capCents,
    approvalThresholdCents: thresholdCents,
    expiresInHours: 72,
    allowedCategories: [...new Set(plan.needs.map((n: Json) => n.category))],
    allowedMerchantIds: snap.merchants.map((m: Json) => m.id),
  });
  await call(`/api/rfqs/${rfqId}/negotiate`, {});
  for (let i = 0; i < 240; i++) {
    snap = await call(`/api/rfqs/${rfqId}`);
    // Wait for the bundle and for the agent's auto-approve attempt to finish.
    const settled = snap.order && (snap.order.state !== "mandate_signed" || (await call(`/api/rfqs/${rfqId}/events?after=0`)).events.some((e: Json) => e.kind === "approval_needed"));
    if (snap.rfq.status === "closed" || settled) break;
    if (snap.order && !snap.vault) break;
    await wait(1000);
  }
  return { rfqId, snap };
}

async function main() {
  console.log(`Haggle Vault e2e against ${BASE}\n`);
  await call("/api/vault", undefined, "DELETE");

  console.log("1. First purchase: pay with the sandbox card and save it for the agent");
  const first = await buy("25 printed name badges for Thursday's board meeting, under $150.", 15_000, 20_000);
  check("bundle built", !!first.snap.order, first.snap.order ? usd(first.snap.order.totalCents) : first.snap.rfq.status);
  check("no saved method yet, so the agent did not pay", first.snap.order?.state === "mandate_signed");
  await call(`/api/orders/${first.snap.order.id}/test-card`, { saveForAgent: true });
  const vault = await call("/api/vault", undefined, "GET");
  check("card saved in PayPal Vault", !!vault.saved, vault.saved ? `${vault.saved.brand} •••• ${vault.saved.lastDigits}` : "none");

  console.log("\n2. Under the threshold: the agent pays on its own");
  const small = await buy("25 printed name badges for Thursday's board meeting, under $150.", 15_000, 20_000);
  check("bundle under threshold", small.snap.order.totalCents <= 20_000, usd(small.snap.order.totalCents));
  check("agent authorized with the saved method", small.snap.order.autoApproved === true && small.snap.order.state === "authorized", small.snap.order.state);
  check("payment method is vault", small.snap.order.paymentMethod === "vault");

  console.log("\n3. Over the threshold: the firewall makes the agent ask");
  const big = await buy("Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800.", 80_000, 20_000);
  const events = (await call(`/api/rfqs/${big.rfqId}/events?after=0`)).events;
  const asked = events.find((e: Json) => e.kind === "approval_needed");
  check("bundle over threshold", big.snap.order.totalCents > 20_000, usd(big.snap.order.totalCents));
  check("agent did not pay", big.snap.order.state === "mandate_signed" && !big.snap.order.autoApproved);
  check("firewall asked for the buyer", !!asked, asked?.payload.reasons.join("; "));

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
