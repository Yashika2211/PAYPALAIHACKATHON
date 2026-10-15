/**
 * Folds the append-only events feed into ledger rows. Pure and deterministic,
 * so the server, the browser and tests all agree on what the ledger says.
 * Rows are keyed by the entity they describe, so later events update them in place.
 */

export type LedgerType = "Quote" | "Firewall" | "Bundle" | "Authorization" | "Capture" | "Payout" | "Fee" | "Void" | "Refund" | "Delivery";

export interface LedgerRow {
  id: string;
  ts: string;
  type: LedgerType;
  rfqId: string | null;
  orderId: string | null;
  party: string;
  amountCents: number | null;
  status: string;
  detail: string;
  rounds?: number[];
}

export interface LedgerEvent {
  seq: number;
  kind: string;
  rfqId: string | null;
  orderId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload shape depends on kind
  payload: Record<string, any>;
  createdAt: string;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Returns the rows this event creates or updates, given the rows so far. */
export function reduceEvent(rows: ReadonlyMap<string, LedgerRow>, e: LedgerEvent): LedgerRow[] {
  const p = e.payload;
  const base = { ts: e.createdAt, rfqId: e.rfqId, orderId: e.orderId };
  const upsert = (id: string, fresh: Omit<LedgerRow, "id">): LedgerRow => {
    const prev = rows.get(id);
    // Later events may not know the order; keep the one we already have.
    return { ...(prev ?? {}), ...fresh, id, orderId: prev?.orderId ?? fresh.orderId };
  };

  switch (e.kind) {
    case "offer": {
      const id = `quote:${e.rfqId}:${p.merchantId}`;
      const prev = rows.get(id);
      const rounds = p.blocked ? (prev?.rounds ?? []) : [...(prev?.rounds ?? []), p.totalCents as number];
      return [
        upsert(id, {
          ...base,
          type: "Quote",
          party: p.merchant,
          amountCents: rounds.length ? rounds[rounds.length - 1] : (p.totalCents as number),
          status: p.blocked ? "blocked" : "negotiating",
          detail: p.blocked ? `Blocked: ${String(p.message).slice(0, 120)}` : `R${p.round}: ${String(p.message).slice(0, 140)}`,
          rounds,
        }),
      ];
    }
    case "negotiation_done": {
      const id = `quote:${e.rfqId}:${p.merchantId}`;
      const prev = rows.get(id);
      if (!prev) return [];
      return [{ ...prev, status: p.status, ts: e.createdAt }];
    }
    case "firewall":
      return [
        {
          id: `fw:${e.seq}`,
          ...base,
          type: "Firewall",
          party: String(p.actor).replace("merchant-agent:", ""),
          amountCents: null,
          status: p.decision,
          detail: `${String(p.action).replace(/_/g, " ")}${p.decision === "allow" ? "" : `: ${(p.reasons as string[]).join("; ")}`}`,
        },
      ];
    case "bundle_ready":
      return [
        {
          id: `bundle:${p.orderId}`,
          ...base,
          orderId: p.orderId,
          type: "Bundle",
          party: "Buyer agent",
          amountCents: p.totalCents,
          status: "quoted",
          detail: p.firstQuoteTotalCents ? `${usd(p.firstQuoteTotalCents - p.totalCents)} below first quotes` : "",
        },
      ];
    case "paypal":
      switch (p.step) {
        case "authorized":
          return [upsert(`auth:${e.orderId}`, { ...base, type: "Authorization", party: "PayPal", amountCents: p.amountCents, status: "held", detail: `Authorization ${p.authorizationId}` })];
        case "captured": {
          const out = [upsert(`cap:${p.allocationId}`, { ...base, type: "Capture", party: p.merchant ?? "Merchant", amountCents: p.amountCents, status: "captured", detail: `Capture ${p.captureId}` })];
          const auth = rows.get(`auth:${e.orderId}`);
          if (auth) out.push({ ...auth, status: "partially captured", ts: e.createdAt });
          return out;
        }
        case "voided":
          return [
            upsert(`void:${e.orderId}`, { ...base, type: "Void", party: "PayPal", amountCents: p.releasedCents, status: "released", detail: "Undelivered share released, never charged" }),
          ];
        case "refunded": {
          const out = [upsert(`refund:${p.allocationId}`, { ...base, type: "Refund", party: p.merchant ?? "Merchant", amountCents: p.amountCents, status: "refunded", detail: `Refund ${p.refundId}` })];
          const cap = rows.get(`cap:${p.allocationId}`);
          if (cap) out.push({ ...cap, status: "refunded" });
          return out;
        }
        default:
          return [];
      }
    case "payout": {
      const id = `payout:${p.allocationId}`;
      if (p.step === "sent") {
        return [
          upsert(id, { ...base, type: "Payout", party: p.merchant, amountCents: p.netCents, status: "pending", detail: `Batch ${p.batchId}` }),
          upsert(`fee:${p.allocationId}`, { ...base, type: "Fee", party: "Haggle", amountCents: p.feeCents, status: "earned", detail: `3% of ${usd(p.grossCents)} from ${p.merchant}` }),
        ];
      }
      const prev = rows.get(id);
      if (!prev) return [];
      return [{ ...prev, ts: e.createdAt, status: p.step === "retried" ? "pending" : p.step, detail: p.batchId ? `Batch ${p.batchId}` : prev.detail }];
    }
    case "delivery":
      return [
        upsert(`delivery:${p.allocationId}`, {
          ...base,
          type: "Delivery",
          party: p.source === "llm" ? "Delivery verifier (AI)" : "Delivery check",
          amountCents: null,
          status: p.pass ? "verified" : "not verified",
          detail: `${Math.round((p.confidence as number) * 100)}%: ${p.reason}`,
        }),
      ];
    default:
      return [];
  }
}

export function buildLedger(events: readonly LedgerEvent[]): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  for (const e of events) for (const r of reduceEvent(rows, e)) rows.set(r.id, r);
  return rows;
}

export interface LedgerTotals {
  heldCents: number;
  capturedCents: number;
  paidOutCents: number;
  feesCents: number;
  releasedCents: number;
  refundedCents: number;
  blocked: number;
}

export function totals(rows: Iterable<LedgerRow>): LedgerTotals {
  const t: LedgerTotals = { heldCents: 0, capturedCents: 0, paidOutCents: 0, feesCents: 0, releasedCents: 0, refundedCents: 0, blocked: 0 };
  for (const r of rows) {
    const a = r.amountCents ?? 0;
    if (r.type === "Authorization") t.heldCents += a;
    if (r.type === "Capture") t.capturedCents += a;
    if (r.type === "Payout" && r.status === "succeeded") t.paidOutCents += a;
    if (r.type === "Fee") t.feesCents += a;
    if (r.type === "Void") t.releasedCents += a;
    if (r.type === "Refund") t.refundedCents += a;
    if (r.type === "Firewall" && r.status === "deny") t.blocked += 1;
  }
  return t;
}
