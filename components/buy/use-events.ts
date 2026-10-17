"use client";

import { useEffect, useState } from "react";
import { FeedEvent, api } from "./types";

export const REFRESH_KINDS = ["bundle_ready", "bundle_failed", "paypal", "order_state", "payout", "mandate_signed", "quarantine", "negotiation_done", "delivery", "approval_needed"];

/**
 * Live events over Server-Sent Events, with polling as a fallback if the stream
 * fails. Events are merged by seq, so reconnects and overlaps are harmless.
 */
export function useEvents(rfqId: string, onImportant: () => void) {
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
