"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fileFromUrl, prepareUpload } from "@/lib/image";
import { formatUsd } from "@/lib/money";
import { Button, Card, Delta, Field, Label, Money, Pill, StatePill, cx, inputClass } from "@/components/ui";

interface Need {
  category: string;
  description: string;
  quantity: number;
  vegetarianShare: number;
}
interface Snapshot {
  rfq: { id: string; rawRequest: string; status: string; lineItems: Need[]; budgetHintCents: number | null; deadline: string | null };
  merchants: Array<{ id: string; name: string; category: string; status: string; tagline: string; personality: string }>;
  mandate: null | { id: string; status: string; budgetCapCents: number; spentCents: number; approvalThresholdCents: number; expiresAt: string; signature: string };
  order: null | { id: string; state: string; totalCents: number; firstQuoteTotalCents: number | null; rationale: string; paypalOrderId: string | null; paypalAuthorizationId: string | null };
  allocations: Array<{
    id: string;
    merchantId: string;
    description: string;
    amountCents: number;
    state: string;
    paypalCaptureId: string | null;
    deliveryPhotoUrl: string | null;
    verifierResult: null | { pass: boolean; confidence: number; reason: string; source: string };
  }>;
  payouts: Array<{ allocationId: string; netCents: number; feeCents: number; status: string; payoutBatchId: string | null }>;
}
interface FeedEvent {
  seq: number;
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads are heterogeneous JSON, rendered defensively
  payload: Record<string, any>;
  createdAt: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PayPal JS SDK ships no types
    paypal?: any;
  }
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

const REFRESH_KINDS = ["bundle_ready", "bundle_failed", "paypal", "order_state", "payout", "mandate_signed", "quarantine", "negotiation_done", "delivery"];

/**
 * Live events over Server-Sent Events, with polling as a fallback if the stream
 * fails. Events are merged by seq, so reconnects and overlaps are harmless.
 */
function useEvents(rfqId: string, onImportant: () => void) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    let after = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | null = null;

    const merge = (fresh: FeedEvent[]) => {
      if (!fresh.length || cancelled) return;
      after = Math.max(after, fresh[fresh.length - 1].seq);
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const added = fresh.filter((e) => !seen.has(e.seq));
        return added.length ? [...prev, ...added] : prev;
      });
      if (fresh.some((e) => REFRESH_KINDS.includes(e.kind))) onImportant();
    };

    const poll = async () => {
      try {
        merge((await api<{ events: FeedEvent[] }>(`/api/rfqs/${rfqId}/events?after=${after}`)).events);
      } catch {
        /* transient; keep polling */
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };

    onImportant(); // initial snapshot
    if (typeof EventSource === "undefined") {
      poll();
    } else {
      source = new EventSource(`/api/rfqs/${rfqId}/stream?after=0`);
      source.onmessage = (m) => merge([JSON.parse(m.data) as FeedEvent]);
      let failures = 0;
      source.onerror = () => {
        if (++failures >= 3 && source) {
          source.close();
          source = null;
          poll();
        }
      };
      source.onopen = () => {
        failures = 0;
      };
    }
    return () => {
      cancelled = true;
      source?.close();
      clearTimeout(timer);
    };
  }, [rfqId, onImportant]);
  return events;
}

const STEPS = ["Request", "Mandate", "Negotiate", "Approve", "Settle"] as const;

function currentStep(s: Snapshot): number {
  if (!s.mandate || s.mandate.status !== "active") return 1;
  if (!s.order) return 2;
  if (s.order.state === "mandate_signed") return 3;
  return 4;
}

export function BuyFlow({ id }: { id: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnap(await api<Snapshot>(`/api/rfqs/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  // The events poller also performs the initial snapshot load.
  const events = useEvents(id, refresh);

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

  if (!snap) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 text-muted">
        {error ? <p className="rounded-md bg-bad-soft px-3 py-2 text-bad">{error}</p> : "Loading your request…"}
      </main>
    );
  }

  const { rfq, mandate, order } = snap;
  const step = currentStep(snap);
  const started = events.some((e) => e.kind === "rfq_sent");
  const bundleFailed = events.find((e) => e.kind === "bundle_failed");

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <ol className="figures flex flex-wrap gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em]">
        {STEPS.map((s, i) => (
          <li key={s} className={cx("flex items-center gap-2", i === step ? "text-ink" : i < step ? "text-muted" : "text-faint")}>
            <span className={cx("grid h-5 w-5 place-items-center rounded-full border text-[10px]", i < step ? "border-good bg-good text-white" : i === step ? "border-accent text-accent" : "border-line-strong")}>
              {i < step ? "✓" : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <header className="mt-6">
        <h1 className="max-w-4xl font-serif text-3xl leading-tight sm:text-4xl">&ldquo;{rfq.rawRequest}&rdquo;</h1>
        <ul className="mt-4 flex flex-wrap gap-2">
          {rfq.lineItems.map((n) => (
            <li key={n.category} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
              <Pill>{n.category}</Pill>
              <span>{n.description}</span>
              <span className="figures text-muted">×{n.quantity}</span>
              {n.vegetarianShare > 0 && n.vegetarianShare < 1 && <span className="text-xs text-good">≥{Math.round(n.vegetarianShare * 100)}% veg</span>}
            </li>
          ))}
          {rfq.deadline && (
            <li className="figures flex items-center rounded-md border border-line px-3 py-1.5 text-xs text-muted">
              due {new Date(rfq.deadline).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </li>
          )}
        </ul>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {!mandate || mandate.status !== "active" ? (
            <MandateForm snap={snap} onSigned={refresh} />
          ) : (
            <MandateBadge mandate={mandate} />
          )}

          {mandate?.status === "active" && rfq.status === "planning" && !started && (
            <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="font-medium">Mandate signed. Ready to negotiate.</p>
                <p className="text-sm text-muted">Your agent will contact every allowed merchant in parallel, up to 4 rounds each.</p>
              </div>
              <Button onClick={run("negotiate", () => api(`/api/rfqs/${id}/negotiate`, {}))} disabled={!!busy}>
                {busy === "negotiate" ? "Starting…" : "Start negotiating →"}
              </Button>
            </Card>
          )}

          <Theater events={events} merchants={snap.merchants} active={started && !order && !bundleFailed} />

          {bundleFailed && !order && (
            <p className="rounded-md border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
              No bundle fits your mandate ({String(bundleFailed.payload.reason).replace(/_/g, " ")}
              {bundleFailed.payload.cheapestCents ? `; cheapest option was ${formatUsd(bundleFailed.payload.cheapestCents)}` : ""}). Nothing was charged.
            </p>
          )}

          {order && <BundlePanel snap={snap} busy={busy} run={run} onAuthorized={refresh} onError={setError} />}

          {error && <p className="rounded-md border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <FirewallFeed events={events} />
          <PayPalTimeline events={events} />
        </aside>
      </div>
    </main>
  );
}

function MandateBadge({ mandate }: { mandate: NonNullable<Snapshot["mandate"]> }) {
  const used = Math.min(100, Math.round((mandate.spentCents / mandate.budgetCapCents) * 100));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pill tone="good">Mandate signed</Pill>
          <span className="figures text-xs text-muted">sig {mandate.signature}</span>
        </div>
        <span className="figures text-xs text-muted">expires {new Date(mandate.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <Label>Budget cap</Label>
          <Money cents={mandate.budgetCapCents} className="mt-1 block text-xl" />
        </div>
        <div>
          <Label>Ask me above</Label>
          <Money cents={mandate.approvalThresholdCents} className="mt-1 block text-xl" />
        </div>
        <div>
          <Label>Held now</Label>
          <Money cents={mandate.spentCents} className="mt-1 block text-xl" />
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${used}%` }} />
      </div>
    </Card>
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

  async function sign(e: React.FormEvent) {
    e.preventDefault();
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rise">
      <form onSubmit={sign}>
        <div className="border-b border-line p-5">
          <h2 className="font-serif text-2xl">Sign your spending mandate</h2>
          <p className="mt-1 text-sm text-muted">
            These limits are signed and enforced in code. Your agent, and anything a merchant agent says, can&apos;t change them.
          </p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Budget cap" hint="Never spend more than this">
            <div className="relative">
              <span className="figures pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
              <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className={cx(inputClass, "figures pl-7")} />
            </div>
          </Field>
          <Field label="Ask me above" hint="Larger payments need your click">
            <div className="relative">
              <span className="figures pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" className={cx(inputClass, "figures pl-7")} />
            </div>
          </Field>
          <Field label="Expires after" hint="Hours until the mandate lapses">
            <select value={hours} onChange={(e) => setHours(e.target.value)} className={inputClass}>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
            </select>
          </Field>
        </div>
        <div className="border-t border-line p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Merchants your agent may deal with</p>
            <p className="text-xs text-muted">Categories: {categories.join(", ")}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {eligible.map((m) => {
              const on = merchantIds.includes(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setMerchantIds((ids) => (on ? ids.filter((x) => x !== m.id) : [...ids, m.id]))}
                  aria-pressed={on}
                  className={cx(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition",
                    on ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-line-strong",
                  )}
                >
                  <span className={cx("h-2 w-2 rounded-full", on ? "bg-accent" : "bg-line-strong")} />
                  <span>
                    {m.name}
                    <span className={cx("ml-1.5 text-xs", on ? "opacity-60" : "text-faint")}>{m.category}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/50 p-5">
          {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-xs text-muted">Signed with HMAC-SHA256. Tampering invalidates it.</p>}
          <Button disabled={busy || merchantIds.length === 0}>{busy ? "Signing…" : "Sign mandate"}</Button>
        </div>
      </form>
    </Card>
  );
}

function Theater({ events, merchants, active }: { events: FeedEvent[]; merchants: Snapshot["merchants"]; active: boolean }) {
  const rows = events.filter((e) => ["rfq_sent", "offer", "counter", "offer_rejected", "negotiation_done"].includes(e.kind));
  const ids = [...new Set(rows.map((e) => e.payload.merchantId as string))];
  if (ids.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-2xl">Negotiation theater</h2>
        {active && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> agents haggling
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ids.map((mid) => {
          const mine = rows.filter((e) => e.payload.merchantId === mid);
          const merchant = merchants.find((m) => m.id === mid);
          const offers = mine.filter((e) => e.kind === "offer" && !e.payload.blocked);
          const first = offers[0]?.payload.totalCents as number | undefined;
          const last = offers[offers.length - 1]?.payload.totalCents as number | undefined;
          const done = mine.find((e) => e.kind === "negotiation_done");
          const blocked = mine.some((e) => e.kind === "offer" && e.payload.blocked);
          return (
            <Card key={mid} className={cx("flex flex-col overflow-hidden", blocked && "flash-bad border-bad/50")}>
              <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{merchant?.name ?? mine[0].payload.merchant}</p>
                  <p className="text-xs text-muted">
                    {merchant?.category} · {merchant?.personality} agent
                  </p>
                </div>
                {done ? <StatePill state={done.payload.status} /> : <Pill tone="accent">live</Pill>}
              </div>
              {first !== undefined && last !== undefined && (
                <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
                  <Money cents={last} className="text-2xl" />
                  <Delta cents={last - first} />
                </div>
              )}
              <ol className="flex flex-col gap-2 p-4 text-sm">
                {mine.map((e) => (
                  <TheaterRow key={e.seq} e={e} />
                ))}
              </ol>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function TheaterRow({ e }: { e: FeedEvent }) {
  const p = e.payload;
  if (e.kind === "rfq_sent") return <li className="rise text-xs text-faint">Request for quote sent</li>;
  if (e.kind === "offer_rejected")
    return <li className="rise rounded border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-xs text-warn">Engine rejected a price below the merchant&apos;s floor. Agent re-proposed.</li>;
  if (e.kind === "negotiation_done") return null;
  if (e.kind === "counter")
    return (
      <li className="rise ml-6 rounded-md bg-sunken px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Your agent · R{p.round}</Label>
          <Money cents={p.totalCents} className="text-sm" />
        </div>
        <p className="mt-1 text-muted">{p.message}</p>
      </li>
    );
  if (p.blocked)
    return (
      <li className="rise rounded-md border border-bad/40 bg-bad-soft px-3 py-2 text-bad">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-bad">Blocked by Mandate Firewall</Label>
          <Pill tone="bad">quarantined</Pill>
        </div>
        <p className="figures mt-1 text-xs break-words line-through opacity-80">{p.message}</p>
      </li>
    );
  return (
    <li className="rise mr-6 rounded-md border border-line px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>
          Merchant · R{p.round}
          {p.source === "llm" ? " · AI" : ""}
        </Label>
        <Money cents={p.totalCents} className="text-sm font-medium" />
      </div>
      <p className="mt-1">{p.message}</p>
    </li>
  );
}

function BundlePanel({
  snap,
  busy,
  run,
  onAuthorized,
  onError,
}: {
  snap: Snapshot;
  busy: string;
  run: (label: string, fn: () => Promise<unknown>) => () => Promise<void>;
  onAuthorized: () => void;
  onError: (m: string) => void;
}) {
  const order = snap.order!;
  const saved = order.firstQuoteTotalCents ? order.firstQuoteTotalCents - order.totalCents : 0;
  const name = (mid: string) => snap.merchants.find((m) => m.id === mid)?.name ?? "Merchant";
  return (
    <Card className="rise overflow-hidden">
      <div className="grid gap-6 border-b border-line p-5 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2">
            <Label>Best bundle</Label>
            <StatePill state={order.state} />
          </div>
          <p className="mt-3 font-serif text-lg leading-snug text-muted italic">{order.rationale}</p>
        </div>
        <div className="sm:text-right">
          <Money cents={order.totalCents} className="text-4xl" />
          {saved > 0 && (
            <p className="mt-1 text-sm text-good">
              <span className="figures">▼ {formatUsd(saved)}</span> vs first quotes
            </p>
          )}
        </div>
      </div>

      <ul className="divide-y divide-line">
        {snap.allocations.map((a) => (
          <AllocationRow
            key={a.id}
            a={a}
            merchant={name(a.merchantId)}
            payout={snap.payouts.find((p) => p.allocationId === a.id)}
            busy={busy}
            run={run}
          />
        ))}
      </ul>

      {order.state === "mandate_signed" && <PayPalCheckout orderId={order.id} onAuthorized={onAuthorized} onError={onError} />}
      {(order.state === "authorized" || order.state === "partially_captured") && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/50 px-5 py-4">
          <p className="text-sm text-muted">Funds are held on PayPal. Each merchant is paid when they deliver.</p>
          <Button variant="secondary" onClick={run("void", () => api(`/api/orders/${order.id}/void`, {}))} disabled={!!busy}>
            {busy === "void" ? "Releasing…" : "Release undelivered hold"}
          </Button>
        </div>
      )}
      {order.paypalOrderId && <DebugPanel orderId={order.id} version={`${order.state}-${snap.payouts.map((p) => p.status).join()}`} />}
    </Card>
  );
}

type Allocation = Snapshot["allocations"][number];
type Runner = (label: string, fn: () => Promise<unknown>) => () => Promise<void>;

/** One merchant's share: delivery photo → AI check → capture → payout, with human overrides. */
function AllocationRow({ a, merchant, payout, busy, run }: { a: Allocation; merchant: string; payout?: Snapshot["payouts"][number]; busy: string; run: Runner }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const v = a.verifierResult;
  const sample = /badge|print/i.test(a.description) ? "/demo/delivery-badges.jpg" : "/demo/delivery-lunch.jpg";

  const submitPhoto = (getFile: () => Promise<File>) =>
    run(`photo-${a.id}`, async () => {
      const prepared = await prepareUpload(await getFile(), 1400);
      await api(`/api/allocations/${a.id}/verify`, { photo: { base64: prepared.base64, mediaType: prepared.mediaType }, thumbnail: prepared.thumbnail });
    });

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{merchant}</p>
          <p className="truncate text-sm text-muted">{a.description.replace(/^[^:]+:\s*/, "")}</p>
          {payout && (
            <p className="figures mt-1 text-xs text-muted">
              payout {formatUsd(payout.netCents)} · fee {formatUsd(payout.feeCents)} ·{" "}
              <span className={payout.status === "succeeded" ? "text-good" : payout.status === "failed" ? "text-bad" : ""}>{payout.status}</span>
            </p>
          )}
        </div>
        <Money cents={a.amountCents} className="text-lg" />
        <StatePill state={a.state} />
      </div>

      {(v || a.deliveryPhotoUrl) && (
        <div className={cx("mt-3 flex gap-3 rounded-md border p-3 text-sm", v?.pass ? "border-good/30 bg-good-soft/50" : "border-warn/30 bg-warn-soft/50")}>
          {a.deliveryPhotoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- small inline data URL thumbnail
            <img src={a.deliveryPhotoUrl} alt="Delivery photo" className="h-16 w-20 shrink-0 rounded object-cover" />
          )}
          {v && (
            <div className="min-w-0">
              <p className={cx("font-medium", v.pass ? "text-good" : "text-warn")}>
                {v.pass ? "Delivery verified by AI" : "AI could not verify this delivery"}
                <span className="figures ml-2 text-xs font-normal text-muted">{Math.round(v.confidence * 100)}% confident</span>
              </p>
              <p className="text-muted">{v.reason}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {a.state === "authorized" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) submitPhoto(async () => f)();
              }}
            />
            <Button variant="good" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === `photo-${a.id}` ? "Checking photo…" : "Merchant: upload delivery photo"}
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={submitPhoto(() => fileFromUrl(sample, "delivery.jpg"))}>
              Use sample delivery photo
            </Button>
            {sample.includes("badges") && (
              <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={submitPhoto(() => fileFromUrl("/demo/delivery-short.jpg", "short.jpg"))}>
                Try a short delivery
              </Button>
            )}
            {v && !v.pass && (
              <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={run(a.id, () => api(`/api/allocations/${a.id}/deliver`, {}))}>
                {busy === a.id ? "Capturing…" : "Buyer: confirm delivered anyway"}
              </Button>
            )}
          </>
        )}
        {payout && (payout.status === "failed" || payout.status === "unclaimed") && (
          <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={run(`retry-${a.id}`, () => api(`/api/allocations/${a.id}/retry-payout`, {}))} disabled={!!busy}>
            {busy === `retry-${a.id}` ? "Retrying…" : "Retry payout"}
          </Button>
        )}
        {a.state === "captured" && (
          <Button variant="ghost" className="px-3 py-1.5 text-xs text-muted" onClick={run(`refund-${a.id}`, () => api(`/api/allocations/${a.id}/refund`, { reason: "Buyer dispute" }))} disabled={!!busy}>
            {busy === `refund-${a.id}` ? "Refunding…" : "Refund this line"}
          </Button>
        )}
      </div>
    </li>
  );
}

interface ApiCall {
  id: string;
  method: string;
  path: string;
  status: number;
  requestId: string | null;
  durationMs: number;
  request: unknown;
  response: unknown;
  createdAt: string;
}

/** Every PayPal REST call for this order, as sent and received (secrets redacted at write time). */
function DebugPanel({ orderId, version }: { orderId: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ calls: ApiCall[] }>(`/api/orders/${orderId}/paypal-calls`)
      .then((d) => !cancelled && setCalls(d.calls))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, orderId, version]);

  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-3 text-left text-sm text-muted hover:text-ink">
        <span className="figures text-xs uppercase tracking-wider">PayPal API log</span>
        <span className="figures text-xs">{open ? "hide" : "show raw requests"}</span>
      </button>
      {open && (
        <ol className="figures max-h-96 overflow-y-auto border-t border-line bg-sunken/40 text-xs">
          {calls.map((c) => (
            <li key={c.id} className="border-b border-line last:border-b-0">
              <button className="flex w-full flex-wrap items-center gap-2 px-5 py-2 text-left hover:bg-sunken" onClick={() => setExpanded((e) => (e === c.id ? null : c.id))}>
                <Pill tone={c.status >= 200 && c.status < 300 ? "good" : "bad"}>{c.status}</Pill>
                <span className="font-medium">{c.method}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.path}</span>
                <span className="text-faint">{c.durationMs}ms</span>
              </button>
              {expanded === c.id && (
                <div className="grid gap-2 px-5 pb-3 md:grid-cols-2">
                  {c.requestId && <p className="text-faint md:col-span-2">PayPal-Request-Id: {c.requestId}</p>}
                  <pre className="max-h-64 overflow-auto rounded bg-surface p-2 whitespace-pre-wrap">{JSON.stringify(c.request, null, 2)}</pre>
                  <pre className="max-h-64 overflow-auto rounded bg-surface p-2 whitespace-pre-wrap">{JSON.stringify(c.response, null, 2)}</pre>
                </div>
              )}
            </li>
          ))}
          {calls.length === 0 && <li className="px-5 py-3 text-muted">No calls yet.</li>}
        </ol>
      )}
    </div>
  );
}

function PayPalCheckout({ orderId, onAuthorized, onError }: { orderId: string; onAuthorized: () => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "processing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { paypalClientId } = await api<{ paypalClientId: string }>("/api/config");
      if (!window.paypal) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>("script[data-haggle-paypal]");
          const s = existing ?? document.createElement("script");
          s.addEventListener("load", () => resolve());
          s.addEventListener("error", () => reject(new Error("Could not load PayPal checkout")));
          if (!existing) {
            s.src = `https://www.paypal.com/sdk/js?client-id=${paypalClientId}&intent=authorize&currency=USD&components=buttons`;
            s.dataset.hagglePaypal = "1";
            document.body.appendChild(s);
          }
        });
      }
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = "";
      await window.paypal
        .Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay", height: 44 },
          createOrder: async () => (await api<{ paypalOrderId: string }>(`/api/orders/${orderId}/paypal`, {})).paypalOrderId,
          onApprove: async () => {
            setState("processing");
            try {
              await api(`/api/orders/${orderId}/authorize`, {});
              onAuthorized();
            } catch (e) {
              onError((e as Error).message);
              setState("ready");
            }
          },
          onError: () => onError("PayPal checkout failed. Please try again."),
        })
        .render(ref.current);
      if (!cancelled) setState("ready");
    })().catch((e) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [orderId, onAuthorized, onError]);

  return (
    <div className="grid gap-5 border-t border-line bg-sunken/50 p-5 sm:grid-cols-[1fr_300px] sm:items-center">
      <div>
        <p className="font-medium">Approve with PayPal</p>
        <p className="mt-1 text-sm text-muted">
          Funds are <b className="text-ink">held, not charged</b>, until delivery. Anything undelivered is released back to you.
        </p>
        {state === "processing" && <p className="mt-2 text-sm text-accent">Authorizing with PayPal…</p>}
      </div>
      <div>
        {state === "loading" && <div className="h-11 animate-pulse rounded-md bg-line" />}
        <div ref={ref} />
        <button
          type="button"
          disabled={state === "processing"}
          onClick={async () => {
            setState("processing");
            try {
              await api(`/api/orders/${orderId}/test-card`, {});
              onAuthorized();
            } catch (e) {
              onError((e as Error).message);
              setState("ready");
            }
          }}
          className="mt-2 w-full rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
        >
          No sandbox login? Use PayPal&apos;s sandbox test card
        </button>
      </div>
    </div>
  );
}

function FirewallFeed({ events }: { events: FeedEvent[] }) {
  const items = events.filter((e) => e.kind === "firewall");
  const denied = items.filter((e) => e.payload.decision === "deny").length;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Mandate Firewall</h2>
        <span className="figures text-xs text-muted">
          {items.length - denied} allow · <span className={denied ? "text-bad" : ""}>{denied} deny</span>
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">Every agent action will be checked here.</p>
      ) : (
        <ol className="flex max-h-[26rem] flex-col-reverse overflow-y-auto">
          {items.map((e) => {
            const d = e.payload.decision as string;
            return (
              <li key={e.seq} className={cx("rise border-b border-line px-4 py-2.5 text-xs last:border-b-0", d === "deny" && "bg-bad-soft/50")}>
                <div className="flex items-center gap-2">
                  <Pill tone={d === "allow" ? "good" : d === "deny" ? "bad" : "warn"}>{d.replace("_", " ")}</Pill>
                  <span className="figures truncate text-muted">{String(e.payload.action).replace(/_/g, " ")}</span>
                </div>
                <p className="mt-1 truncate text-faint">{String(e.payload.actor).replace("merchant-agent:", "")}</p>
                {d !== "allow" && <p className="mt-1 text-bad">{(e.payload.reasons as string[]).join("; ")}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

const PAYPAL_STEP: Record<string, string> = {
  order_created: "PayPal order created",
  approved_webhook: "Buyer approved",
  authorized: "Funds authorized (held)",
  captured: "Merchant share captured",
  voided: "Hold released",
  sent: "Payout sent",
  succeeded: "Payout succeeded",
  failed: "Payout failed",
  retried: "Payout re-sent",
  refunded: "Refunded to buyer",
  unclaimed: "Payout unclaimed",
};

function PayPalTimeline({ events }: { events: FeedEvent[] }) {
  const items = events.filter((e) => ["paypal", "payout", "order_state", "delivery"].includes(e.kind));
  return (
    <Card>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">PayPal timeline</h2>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">Authorizations, captures and payouts appear here as PayPal confirms them.</p>
      ) : (
        <ol className="relative px-4 py-3">
          <span className="absolute top-4 bottom-4 left-[21px] w-px bg-line" aria-hidden />
          {items.map((e) => {
            const p = e.payload;
            const amount = p.amountCents ?? p.netCents ?? p.releasedCents;
            const label =
              e.kind === "order_state"
                ? `Order ${String(p.to).replace(/_/g, " ")}`
                : e.kind === "delivery"
                  ? p.pass
                    ? "Delivery photo verified by AI"
                    : "Delivery photo not verified"
                  : (PAYPAL_STEP[p.step] ?? p.step);
            const tone =
              e.kind === "order_state" ? "bg-ink" : e.kind === "delivery" ? (p.pass ? "bg-good" : "bg-warn") : p.step === "failed" ? "bg-bad" : p.step === "voided" ? "bg-faint" : "bg-accent";
            return (
              <li key={e.seq} className="rise relative flex gap-3 py-1.5 text-xs">
                <span className={cx("relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface", tone)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{label}</span>
                    {amount != null && <Money cents={amount} className="text-muted" />}
                  </div>
                  <span className="figures text-faint">{new Date(e.createdAt).toLocaleTimeString()}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
