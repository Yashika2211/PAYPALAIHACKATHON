"use client";

import { useState } from "react";
import { formatUsd } from "@/lib/money";
import { Button, Card, Field, Label, Money, Pill, cx, inputClass } from "@/components/ui";
import { Snapshot, api } from "./types";

export function MandateBadge({ mandate, vault, onChange }: { mandate: NonNullable<Snapshot["mandate"]>; vault: Snapshot["vault"]; onChange: () => void }) {
  const [removing, setRemoving] = useState(false);
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
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
        {vault ? (
          <>
            <span>
              <Pill tone="accent">PayPal Vault</Pill>{" "}
              <span className="text-muted">
                Your agent can pay with your saved {vault.brand?.toLowerCase() ?? "card"} •••• {vault.lastDigits} for bundles up to{" "}
                <b className="text-ink">{formatUsd(mandate.approvalThresholdCents)}</b>. Above that, it asks you.
              </span>
            </span>
            <button
              className="text-xs text-muted underline-offset-4 hover:text-bad hover:underline"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                await fetch("/api/vault", { method: "DELETE" });
                setRemoving(false);
                onChange();
              }}
            >
              {removing ? "Removing…" : "Remove saved method"}
            </button>
          </>
        ) : (
          <span className="text-muted">No saved payment method. Your agent will ask you to approve every purchase.</span>
        )}
      </div>
    </Card>
  );
}

export function MandateForm({ snap, onSigned }: { snap: Snapshot; onSigned: () => void }) {
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
