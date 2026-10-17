"use client";

import { useEffect, useRef, useState } from "react";
import { fileFromUrl, prepareUpload } from "@/lib/image";
import { formatUsd } from "@/lib/money";
import { Button, Card, Label, Money, Pill, StatePill, cx } from "@/components/ui";
import { PayPalCheckout } from "./checkout";
import { FeedEvent, Snapshot, api } from "./types";

export function BundlePanel({
  snap,
  events,
  busy,
  run,
  onAuthorized,
  onError,
}: {
  snap: Snapshot;
  events: FeedEvent[];
  busy: string;
  run: (label: string, fn: () => Promise<unknown>) => () => Promise<void>;
  onAuthorized: () => void;
  onError: (m: string) => void;
}) {
  const order = snap.order!;
  const saved = order.firstQuoteTotalCents ? order.firstQuoteTotalCents - order.totalCents : 0;
  const name = (mid: string) => snap.merchants.find((m) => m.id === mid)?.name ?? "Merchant";
  const approvalEvent = [...events].reverse().find((e) => e.kind === "approval_needed" && e.orderId === order.id);
  const approvalReason = approvalEvent ? (approvalEvent.payload.reasons as string[]).join("; ") : null;
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

      {order.autoApproved && (
        <div className="flex items-start gap-3 border-b border-line bg-good-soft/60 px-5 py-3 text-sm">
          <Pill tone="good">Agent paid</Pill>
          <p className="text-ink">
            Your agent authorized this on its own with your saved PayPal Vault method: {formatUsd(order.totalCents)} is within your auto-approve limit. The funds are
            only held until each merchant delivers.
          </p>
        </div>
      )}
      {approvalReason && order.state === "mandate_signed" && (
        <div className="flex items-start gap-3 border-b border-line bg-warn-soft/60 px-5 py-3 text-sm">
          <Pill tone="warn">Needs you</Pill>
          <p className="text-ink">Your agent didn&apos;t pay on its own: {approvalReason}.</p>
        </div>
      )}
      {order.paymentMethod === "invoice" && <InvoicePanel snap={snap} events={events} busy={busy} run={run} />}
      <ul className="divide-y divide-line">
        {snap.allocations.map((a) => (
          <AllocationRow
            key={a.id}
            invoiceOrder={order.paymentMethod === "invoice"}
            a={a}
            merchant={name(a.merchantId)}
            payout={snap.payouts.find((p) => p.allocationId === a.id)}
            busy={busy}
            run={run}
          />
        ))}
      </ul>

      {order.state === "mandate_signed" && <PayPalCheckout orderId={order.id} onAuthorized={onAuthorized} onError={onError} />}
      {order.state === "invoiced" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/50 px-5 py-4">
          <p className="text-sm text-muted">Nothing has been paid yet. Cancelling the invoice releases your budget.</p>
          <Button variant="secondary" onClick={run("void", () => api(`/api/orders/${order.id}/void`, {}))} disabled={!!busy}>
            {busy === "void" ? "Cancelling…" : "Cancel invoice"}
          </Button>
        </div>
      )}
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

export type Allocation = Snapshot["allocations"][number];
export type Runner = (label: string, fn: () => Promise<unknown>) => () => Promise<void>;

/** One merchant's share: delivery photo → AI check → capture → payout, with human overrides. */
export function AllocationRow({
  a,
  merchant,
  payout,
  busy,
  run,
  invoiceOrder,
}: {
  a: Allocation;
  merchant: string;
  payout?: Snapshot["payouts"][number];
  busy: string;
  run: Runner;
  invoiceOrder: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const v = a.verifierResult;
  // Demo photos that match each seeded merchant's order; real merchants upload their own.
  const sample = /badge|print/i.test(a.description)
    ? "/demo/delivery-badges.jpg"
    : /tandoor|chana|butter chicken/i.test(`${merchant} ${a.description}`)
      ? "/demo/delivery-tandoor.jpg"
      : "/demo/delivery-lunch.jpg";

  const submitPhoto = (getFile: () => Promise<File>, sampleId?: string) =>
    run(`photo-${a.id}`, async () => {
      const prepared = await prepareUpload(await getFile(), 1400);
      await api(`/api/allocations/${a.id}/verify`, {
        photo: { base64: prepared.base64, mediaType: prepared.mediaType },
        thumbnail: prepared.thumbnail,
        sampleId,
      });
    });
  const sampleId = sample.includes("badges") ? "badges" : sample.includes("tandoor") ? "tandoor" : "lunch";

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
              {payout.status === "failed" && payout.failureReason && <span className="block text-bad">{payout.failureReason}. Haggle retries automatically.</span>}
            </p>
          )}
        </div>
        <Money cents={a.amountCents} className="text-lg" />
        {invoiceOrder ? (
          <>
            <Pill tone={a.state === "captured" ? "good" : a.state === "voided" ? "neutral" : "warn"}>{a.state === "captured" ? "paid" : a.state === "pending" ? "awaiting payment" : a.state}</Pill>
            {a.deliveredAt && <Pill tone="good">delivered</Pill>}
          </>
        ) : (
          <StatePill state={a.state} />
        )}
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
                <span className="figures ml-2 text-xs font-normal text-muted">
                  {Math.round(v.confidence * 100)}% confident{v.source === "cache" ? " · cached AI answer" : ""}
                </span>
              </p>
              <p className="text-muted">{v.reason}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(a.state === "authorized" || (invoiceOrder && !a.deliveredAt && (a.state === "pending" || a.state === "captured"))) && (
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
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={submitPhoto(() => fileFromUrl(sample, "delivery.jpg"), sampleId)}>
              Use sample delivery photo
            </Button>
            {sample.includes("badges") && (
              <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={submitPhoto(() => fileFromUrl("/demo/delivery-short.jpg", "short.jpg"), "short")}>
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

export interface ApiCall {
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
export function DebugPanel({ orderId, version }: { orderId: string; version: string }) {
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

/** Net-terms orders: the PayPal invoice the billing agent issued, and its status. */
export function InvoicePanel({ snap, events, busy, run }: { snap: Snapshot; events: FeedEvent[]; busy: string; run: Runner }) {
  const order = snap.order!;
  const sent = [...events].reverse().find((e) => e.kind === "paypal" && e.payload.step === "invoice_sent" && e.orderId === order.id);
  const paid = snap.allocations.every((a) => a.state === "captured" || a.state === "refunded");
  const cancelled = snap.allocations.every((a) => a.state === "voided");
  return (
    <div className={cx("flex flex-wrap items-start gap-3 border-b border-line px-5 py-3 text-sm", paid ? "bg-good-soft/60" : cancelled ? "bg-sunken/60" : "bg-warn-soft/50")}>
      <Pill tone={paid ? "good" : cancelled ? "neutral" : "warn"}>{paid ? "invoice paid" : cancelled ? "invoice cancelled" : "invoice sent"}</Pill>
      <div className="min-w-0 flex-1">
        <p className="text-ink">
          {sent?.payload.agent && sent.payload.agent !== "deterministic"
            ? `Haggle's billing agent (${sent.payload.agent}) issued `
            : "Haggle issued "}
          PayPal invoice <span className="figures">{sent?.payload.invoiceNumber ?? order.paypalInvoiceId}</span> through the PayPal Agent Toolkit, on Net 15
          terms. Every toolkit call was checked against this bundle and the Mandate Firewall.
        </p>
        <p className="mt-1 text-muted">
          {paid
            ? "Funds are in. Each merchant is paid out as soon as their delivery is verified."
            : cancelled
              ? "Nothing was charged."
              : "Merchants can deliver now; they are paid out once the invoice is paid and their delivery is verified."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sent?.payload.url && (
            <a href={sent.payload.url} target="_blank" rel="noreferrer" className="text-xs text-ink underline underline-offset-4">
              View invoice as the buyer
            </a>
          )}
          {!paid && !cancelled && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!!busy} onClick={run("invoice-pay", () => api(`/api/orders/${order.id}/invoice/pay`, {}))}>
              {busy === "invoice-pay" ? "Recording payment…" : "Sandbox: buyer pays the invoice"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
