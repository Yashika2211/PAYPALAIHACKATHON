"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./types";

export function PayPalCheckout({ orderId, onAuthorized, onError }: { orderId: string; onAuthorized: () => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "processing">("loading");
  const [saveForAgent, setSaveForAgent] = useState(true);

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
        {state === "processing" && <p className="mt-2 text-sm text-accent">Working with PayPal…</p>}
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
              await api(`/api/orders/${orderId}/test-card`, { saveForAgent });
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
        <button
          type="button"
          disabled={state === "processing"}
          onClick={async () => {
            setState("processing");
            try {
              await api(`/api/orders/${orderId}/invoice`, {});
              onAuthorized();
            } catch (e) {
              onError((e as Error).message);
              setState("ready");
            }
          }}
          className="mt-2 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink transition hover:bg-sunken disabled:opacity-50"
        >
          Business buyer? Pay by PayPal invoice (Net 15)
        </button>
        <label className="mt-2 flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" checked={saveForAgent} onChange={(e) => setSaveForAgent(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          Save the card in PayPal Vault so my agent can pay on its own for bundles under my auto-approve limit.
        </label>
      </div>
    </div>
  );
}
