"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsd } from "@/lib/money";

/* M1 buyer flow: plan → mandate → negotiation → bundle → PayPal → settlement. Design pass comes in M6. */

interface Need {
  category: string;
  description: string;
  quantity: number;
  vegetarianShare: number;
}
interface Snapshot {
  rfq: { id: string; rawRequest: string; status: string; lineItems: Need[]; budgetHintCents: number | null; deadline: string | null };
  merchants: Array<{ id: string; name: string; category: string; status: string; tagline: string }>;
  mandate: null | { id: string; status: string; budgetCapCents: number; spentCents: number; approvalThresholdCents: number; expiresAt: string; signature: string };
  order: null | { id: string; state: string; totalCents: number; firstQuoteTotalCents: number | null; rationale: string; paypalOrderId: string | null; paypalAuthorizationId: string | null };
  allocations: Array<{ id: string; merchantId: string; description: string; amountCents: number; state: string; paypalCaptureId: string | null }>;
  payouts: Array<{ allocationId: string; netCents: number; feeCents: number; status: string; payoutBatchId: string | null }>;
}
interface FeedEvent {
  seq: number;
  kind: string;
  payload: Record<string, any>;
  createdAt: string;
}

declare global {
  interface Window {
    paypal?: any;
  }
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function BuyFlow() {
  const { id } = useParams<{ id: string }>();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const lastSeq = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setSnap(await api<Snapshot>(`/api/rfqs/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const { events: fresh } = await api<{ events: FeedEvent[] }>(`/api/rfqs/${id}/events?after=${lastSeq.current}`);
        if (fresh.length) {
          lastSeq.current = fresh[fresh.length - 1].seq;
          setEvents((prev) => [...prev, ...fresh]);
          if (fresh.some((e) => ["bundle_ready", "bundle_failed", "paypal", "order_state", "payout", "mandate_signed", "quarantine"].includes(e.kind))) refresh();
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 700);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id, refresh]);

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!snap) return <main className="p-8 text-neutral-500">{error || "Loading…"}</main>;
  const { rfq, mandate, order } = snap;
  const merchantName = (mid: string) => snap.merchants.find((m) => m.id === mid)?.name ?? mid.slice(0, 8);
  const negotiating = mandate?.status === "active" && !order && rfq.status === "negotiating";

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-8 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section>
          <p className="text-sm uppercase tracking-wide text-neutral-500">Request</p>
          <h1 className="text-xl font-semibold">{rfq.rawRequest}</h1>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {rfq.lineItems.map((n) => (
              <li key={n.category} className="rounded-full border border-neutral-300 px-3 py-1 dark:border-neutral-700">
                {n.category}: {n.description} ({n.quantity})
                {n.vegetarianShare > 0 && n.category !== "bakery" ? `, ≥${Math.round(n.vegetarianShare * 100)}% veg` : ""}
              </li>
            ))}
          </ul>
        </section>

        {!mandate || mandate.status !== "active" ? (
          <MandateForm snap={snap} onSigned={refresh} />
        ) : (
          <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950">
            <b>Mandate signed</b>: cap {formatUsd(mandate.budgetCapCents)}, auto-approve up to {formatUsd(mandate.approvalThresholdCents)}, expires{" "}
            {new Date(mandate.expiresAt).toLocaleString()}. Held: {formatUsd(mandate.spentCents)}. Signature <code>{mandate.signature}</code>
          </section>
        )}

        {mandate?.status === "active" && rfq.status === "planning" && (
          <button
            onClick={run("negotiate", () => api(`/api/rfqs/${id}/negotiate`, {}))}
            disabled={!!busy}
            className="self-start rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            Start negotiating
          </button>
        )}

        <Negotiations events={events} />
        {negotiating && <p className="text-sm text-neutral-500">Agents are negotiating…</p>}

        {events.some((e) => e.kind === "bundle_failed") && !order && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            No bundle fits the mandate: {events.find((e) => e.kind === "bundle_failed")!.payload.reason}
          </p>
        )}

        {order && (
          <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Best bundle: {formatUsd(order.totalCents)}</h2>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium dark:bg-neutral-800">{order.state}</span>
            </div>
            {order.firstQuoteTotalCents && order.firstQuoteTotalCents > order.totalCents && (
              <p className="text-sm text-emerald-600">
                Saved {formatUsd(order.firstQuoteTotalCents - order.totalCents)} vs first quotes ({formatUsd(order.firstQuoteTotalCents)})
              </p>
            )}
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{order.rationale}</p>
            <ul className="mt-4 flex flex-col gap-2">
              {snap.allocations.map((a) => {
                const payout = snap.payouts.find((p) => p.allocationId === a.id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
                    <span className="min-w-0 flex-1">{a.description}</span>
                    <b>{formatUsd(a.amountCents)}</b>
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-700">{a.state}</span>
                    {payout && (
                      <span className="text-xs text-neutral-500">
                        payout {formatUsd(payout.netCents)} (fee {formatUsd(payout.feeCents)}): {payout.status}
                      </span>
                    )}
                    {a.state === "authorized" && (
                      <button
                        onClick={run(a.id, () => api(`/api/allocations/${a.id}/deliver`, {}))}
                        disabled={!!busy}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {busy === a.id ? "Capturing…" : "Merchant: mark delivered"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {order.state === "mandate_signed" && <PayPalCheckout orderId={order.id} onAuthorized={refresh} onError={setError} />}
            {(order.state === "authorized" || order.state === "partially_captured") && (
              <button
                onClick={run("void", () => api(`/api/orders/${order.id}/void`, {}))}
                disabled={!!busy}
                className="mt-4 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                Release undelivered hold (void)
              </button>
            )}
          </section>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      </div>

      <aside className="flex flex-col gap-4">
        <Feed title="Mandate Firewall" items={events.filter((e) => e.kind === "firewall" || e.kind === "quarantine")} />
        <Feed title="PayPal timeline" items={events.filter((e) => ["paypal", "payout", "order_state"].includes(e.kind))} />
      </aside>
    </main>
  );
}

function MandateForm({ snap, onSigned }: { snap: Snapshot; onSigned: () => void }) {
  const categories = [...new Set(snap.rfq.lineItems.map((n) => n.category))];
  const eligible = snap.merchants.filter((m) => m.status !== "draft");
  const [cap, setCap] = useState(String((snap.rfq.budgetHintCents ?? 50_000) / 100));
  const [threshold, setThreshold] = useState("200");
  const [hours, setHours] = useState("72");
  const [merchantIds, setMerchantIds] = useState(eligible.map((m) => m.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sign() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rfqs/${snap.rfq.id}/mandate`, {
        budgetCapCents: Math.round(Number(cap) * 100),
        approvalThresholdCents: Math.round(Number(threshold) * 100),
        expiresInHours: Number(hours),
        allowedCategories: categories,
        allowedMerchantIds: merchantIds,
      });
      onSigned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="font-semibold">Sign a spending mandate</h2>
      <p className="text-sm text-neutral-500">Your agent can never exceed these limits. They are enforced in code, not by the AI.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Budget cap ($)
          <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" />
        </label>
        <label className="text-sm">
          Ask me above ($)
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" />
        </label>
        <label className="text-sm">
          Expires in (hours)
          <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 dark:border-neutral-700" />
        </label>
      </div>
      <p className="mt-3 text-sm">Categories: {categories.join(", ")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {eligible.map((m) => (
          <label key={m.id} className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
            <input
              type="checkbox"
              checked={merchantIds.includes(m.id)}
              onChange={(e) => setMerchantIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))}
            />
            {m.name}
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button onClick={sign} disabled={busy || merchantIds.length === 0} className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white disabled:opacity-50">
        {busy ? "Signing…" : "Sign mandate"}
      </button>
    </section>
  );
}

function Negotiations({ events }: { events: FeedEvent[] }) {
  const rows = events.filter((e) => ["rfq_sent", "offer", "counter", "offer_rejected", "negotiation_done"].includes(e.kind));
  const merchants = [...new Set(rows.map((e) => e.payload.merchant as string))];
  if (merchants.length === 0) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {merchants.map((name) => (
        <div key={name} className="rounded-xl border border-neutral-300 p-3 text-sm dark:border-neutral-700">
          <h3 className="font-semibold">{name}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {rows
              .filter((e) => e.payload.merchant === name)
              .map((e) => (
                <li
                  key={e.seq}
                  className={
                    e.kind === "offer" && e.payload.blocked
                      ? "rounded-md bg-red-100 p-2 text-red-800 dark:bg-red-950 dark:text-red-200"
                      : e.kind === "counter"
                        ? "rounded-md bg-blue-50 p-2 dark:bg-blue-950"
                        : "rounded-md bg-neutral-50 p-2 dark:bg-neutral-900"
                  }
                >
                  {e.kind === "rfq_sent" && <span className="text-neutral-500">Request for quote sent</span>}
                  {e.kind === "offer" && (
                    <>
                      <b>{e.payload.blocked ? "BLOCKED " : ""}R{e.payload.round} offer {formatUsd(e.payload.totalCents)}</b>
                      <span className="ml-1 text-xs text-neutral-500">({e.payload.source})</span>
                      <p>{e.payload.message}</p>
                    </>
                  )}
                  {e.kind === "counter" && (
                    <>
                      <b>Buyer counter {formatUsd(e.payload.totalCents)}</b>
                      <p>{e.payload.message}</p>
                    </>
                  )}
                  {e.kind === "offer_rejected" && <span className="text-amber-700">Engine rejected a sub-floor price, agent re-proposed</span>}
                  {e.kind === "negotiation_done" && <span className="font-medium">Done: {e.payload.status}</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Feed({ title, items }: { title: string; items: FeedEvent[] }) {
  return (
    <section className="rounded-xl border border-neutral-300 p-3 text-xs dark:border-neutral-700">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {items.length === 0 && <p className="text-neutral-500">Nothing yet.</p>}
      <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
        {items.map((e) => (
          <li key={e.seq} className="rounded-md bg-neutral-50 p-2 dark:bg-neutral-900">
            {e.kind === "firewall" && (
              <>
                <span
                  className={
                    e.payload.decision === "allow"
                      ? "font-semibold text-emerald-600"
                      : e.payload.decision === "deny"
                        ? "font-semibold text-red-600"
                        : "font-semibold text-amber-600"
                  }
                >
                  {String(e.payload.decision).toUpperCase()}
                </span>{" "}
                {e.payload.actor} · {e.payload.action}
                {e.payload.decision !== "allow" && <p className="text-neutral-500">{(e.payload.reasons as string[]).join("; ")}</p>}
              </>
            )}
            {e.kind === "quarantine" && <b className="text-red-600">Merchant quarantined</b>}
            {e.kind === "order_state" && (
              <span>
                Order: {e.payload.from} → <b>{e.payload.to}</b>
              </span>
            )}
            {(e.kind === "paypal" || e.kind === "payout") && (
              <span>
                <b>{e.kind === "payout" ? "Payout" : "PayPal"}: {e.payload.step}</b>{" "}
                {e.payload.amountCents != null && formatUsd(e.payload.amountCents)}
                {e.payload.netCents != null && `net ${formatUsd(e.payload.netCents)}`}
                {e.payload.releasedCents != null && `released ${formatUsd(e.payload.releasedCents)}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PayPalCheckout({ orderId, onAuthorized, onError }: { orderId: string; onAuthorized: () => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { paypalClientId } = await api<{ paypalClientId: string }>("/api/config");
      if (!window.paypal) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = `https://www.paypal.com/sdk/js?client-id=${paypalClientId}&intent=authorize&currency=USD&components=buttons`;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Could not load PayPal"));
          document.body.appendChild(s);
        });
      }
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = "";
      window.paypal
        .Buttons({
          style: { layout: "vertical", label: "pay" },
          createOrder: async () => (await api<{ paypalOrderId: string }>(`/api/orders/${orderId}/paypal`, {})).paypalOrderId,
          onApprove: async () => {
            await api(`/api/orders/${orderId}/authorize`, {});
            onAuthorized();
          },
          onError: (err: unknown) => onError(err instanceof Error ? err.message : "PayPal checkout failed"),
        })
        .render(ref.current);
    })().catch((e) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [orderId, onAuthorized, onError]);

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm text-neutral-500">Funds are held, not charged, until delivery.</p>
      <div ref={ref} className="max-w-sm" />
    </div>
  );
}
