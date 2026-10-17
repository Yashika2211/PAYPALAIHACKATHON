"use client";

import { useState } from "react";
import { Card, Delta, Label, Money, Pill, StatePill, cx } from "@/components/ui";
import type { FeedEvent, Snapshot } from "./types";

export function Theater({ events, merchants, active }: { events: FeedEvent[]; merchants: Snapshot["merchants"]; active: boolean }) {
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
              <TheaterTranscript events={mine} done={!!done} />
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/** Live while negotiating; once done, older rounds fold away so the page stays short. */
export function TheaterTranscript({ events, done }: { events: FeedEvent[]; done: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = events.filter((e) => e.kind !== "negotiation_done");
  const KEEP = 3;
  const folded = done && !expanded && visible.length > KEEP + 1;
  const shown = folded ? visible.slice(-KEEP) : visible;
  return (
    <ol className="flex flex-col gap-2 p-4 text-sm">
      {folded && (
        <li>
          <button onClick={() => setExpanded(true)} className="figures w-full rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:text-ink">
            Show all {visible.length} messages
          </button>
        </li>
      )}
      {shown.map((e) => (
        <TheaterRow key={e.seq} e={e} />
      ))}
    </ol>
  );
}

export function TheaterRow({ e }: { e: FeedEvent }) {
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
