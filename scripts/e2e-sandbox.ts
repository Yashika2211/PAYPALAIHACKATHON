export {};

/**
 * End-to-end run against a live Haggle server and the real PayPal sandbox.
 * request → mandate → parallel negotiation (rogue blocked) → bundle →
 * authorize (sandbox test card) → one merchant delivers (capture + payout) →
 * the rest is voided (never charged) → assertions on every state.
 *
 * Usage: pnpm e2e:sandbox [baseUrl]
 */
const BASE = process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose test client

async function call(path: string, body?: unknown): Promise<Json> {
  const res = await fetch(BASE + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${data.error ?? ""}`);
  return data;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  console.log(`Haggle e2e against ${BASE}\n`);
  const health = await call("/api/health");
  check("health ok", health.status === "ok", `ai ${health.ai.smart}`);

  console.log("\n1. Request");
  const { rfqId, plan, source } = await call("/api/rfqs", {
    request: "Catering plus printed name badges for a 40-person workshop this Friday, at least half vegetarian, total under $800.",
  });
  check("plan has catering + printing", ["catering", "printing"].every((c) => plan.needs.some((n: Json) => n.category === c)), `via ${source}`);
  check("budget parsed", plan.budgetCents === 80_000, usd(plan.budgetCents ?? 0));

  console.log("\n2. Mandate");
  let snap = await call(`/api/rfqs/${rfqId}`);
  await call(`/api/rfqs/${rfqId}/mandate`, {
    budgetCapCents: 80_000,
    approvalThresholdCents: 20_000,
    expiresInHours: 72,
    allowedCategories: ["catering", "printing"],
    allowedMerchantIds: snap.merchants.map((m: Json) => m.id),
  });
  snap = await call(`/api/rfqs/${rfqId}`);
  check("mandate active", snap.mandate?.status === "active");

  console.log("\n3. Negotiation");
  await call(`/api/rfqs/${rfqId}/negotiate`, {});
  for (let i = 0; i < 180 && !["bundled", "closed"].includes(snap.rfq.status); i++) {
    await wait(1000);
    snap = await call(`/api/rfqs/${rfqId}`);
  }
  const { events } = await call(`/api/rfqs/${rfqId}/events?after=0`);
  const offers = events.filter((e: Json) => e.kind === "offer");
  check("bundle built", snap.rfq.status === "bundled" && !!snap.order, snap.order ? usd(snap.order.totalCents) : snap.rfq.status);
  check("rogue injection blocked", events.some((e: Json) => e.kind === "quarantine"));
  check("merchants negotiated down", offers.length >= 4, `${offers.length} offers`);
  check("bundle within mandate", snap.order.totalCents <= 80_000);
  check("savings vs first quotes", snap.order.firstQuoteTotalCents > snap.order.totalCents, usd(snap.order.firstQuoteTotalCents - snap.order.totalCents));

  console.log("\n4. Authorize on PayPal (held, not charged)");
  const { authorizationId } = await call(`/api/orders/${snap.order.id}/test-card`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("authorized", snap.order.state === "authorized", authorizationId);
  check("all allocations held", snap.allocations.every((a: Json) => a.state === "authorized"));
  check("mandate reserves the hold", snap.mandate.spentCents === snap.order.totalCents, usd(snap.mandate.spentCents));

  console.log("\n5. First merchant delivers → partial capture + payout");
  const [delivered, ...undelivered] = snap.allocations;
  await call(`/api/allocations/${delivered.id}/deliver`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("partially captured", snap.order.state === "partially_captured");
  const payout = snap.payouts.find((p: Json) => p.allocationId === delivered.id);
  check("payout sent net of 3% fee", !!payout && payout.feeCents === Math.round(delivered.amountCents * 0.03), payout ? `${usd(payout.netCents)} + fee ${usd(payout.feeCents)}` : "none");

  console.log("\n6. Release the rest → never charged");
  await call(`/api/orders/${snap.order.id}/void`, {});
  snap = await call(`/api/rfqs/${rfqId}`);
  check("order settled", snap.order.state === "settled");
  check("undelivered voided", undelivered.every((u: Json) => snap.allocations.find((a: Json) => a.id === u.id)?.state === "voided"));
  check("mandate hold released", snap.mandate.spentCents === delivered.amountCents, usd(snap.mandate.spentCents));

  console.log("\n7. Webhooks (PayPal → tunnel)");
  let hooks: Json[] = [];
  for (let i = 0; i < 18; i++) {
    hooks = (await call(`/api/rfqs/${rfqId}/events?after=0`)).events.filter((e: Json) => e.kind === "payout" && ["succeeded", "failed"].includes(e.payload.step));
    if (hooks.length) break;
    await wait(10_000);
  }
  check("payout result arrived by webhook", hooks.length > 0, hooks[0]?.payload.step ?? "none yet (is the tunnel registered?)");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});