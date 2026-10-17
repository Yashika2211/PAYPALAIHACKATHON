"use client";

import { Card, Money, Pill, cx } from "@/components/ui";
import type { FeedEvent } from "./types";

export function FirewallFeed({ events }: { events: FeedEvent[] }) {
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

export const PAYPAL_STEP: Record<string, string> = {
  order_created: "PayPal order created",
  vaulted: "Card saved in PayPal Vault",
  invoice_sent: "Invoice sent (Net 15)",
  invoice_paid: "Invoice paid",
  invoice_cancelled: "Invoice cancelled",
  delivered: "Delivery recorded",
  auto_approved: "Agent paid with saved method",
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

export function PayPalTimeline({ events }: { events: FeedEvent[] }) {
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
