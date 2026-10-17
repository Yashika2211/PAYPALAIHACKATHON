"use client";

import { useCallback, useState } from "react";
import { formatUsd } from "@/lib/money";
import { Button, Card, Pill, cx } from "@/components/ui";
import { BundlePanel } from "./buy/bundle";
import { FirewallFeed, PayPalTimeline } from "./buy/feeds";
import { MandateBadge, MandateForm } from "./buy/mandate";
import { Theater } from "./buy/theater";
import { api, type Snapshot } from "./buy/types";
import { useEvents } from "./buy/use-events";

export const STEPS = ["Request", "Mandate", "Negotiate", "Approve", "Settle"] as const;

export function currentStep(s: Snapshot): number {
  if (!s.mandate) return 1;
  if (!s.order) return s.mandate.status === "active" ? 2 : 1;
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
      <ol aria-label="Progress" className="figures flex flex-wrap gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em]">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cx("flex items-center gap-2", i === step ? "text-ink" : i < step ? "text-muted" : "text-faint")}>
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
            <MandateBadge mandate={mandate} vault={snap.vault} onChange={refresh} />
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

          {order && <BundlePanel snap={snap} events={events} busy={busy} run={run} onAuthorized={refresh} onError={setError} />}

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
