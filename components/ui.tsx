import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatUsd } from "@/lib/money";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "good";
const BUTTON: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-95 active:brightness-90",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
  good: "bg-good text-white hover:brightness-95",
};
const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, BUTTON[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, BUTTON[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("figures text-[11px] font-medium uppercase tracking-[0.12em] text-muted", className)}>{children}</p>;
}

type Tone = "neutral" | "good" | "bad" | "warn" | "accent";
const PILL: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
};
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("figures inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide", PILL[tone], className)}>
      {children}
    </span>
  );
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cx("figures", className)}>{formatUsd(cents)}</span>;
}

export function Delta({ cents }: { cents: number }) {
  if (cents === 0) return null;
  const down = cents < 0;
  return (
    <span className={cx("figures text-xs", down ? "text-good" : "text-bad")}>
      {down ? "▼" : "▲"} {formatUsd(Math.abs(cents))}
    </span>
  );
}

export const STATE_TONE: Record<string, Tone> = {
  pending: "neutral",
  draft: "neutral",
  quoted: "neutral",
  mandate_signed: "accent",
  authorized: "warn",
  partially_captured: "warn",
  captured: "good",
  settled: "good",
  succeeded: "good",
  voided: "neutral",
  refunded: "neutral",
  failed: "bad",
  unclaimed: "warn",
  quarantined: "bad",
  live: "good",
};

export function StatePill({ state }: { state: string }) {
  return <Pill tone={STATE_TONE[state] ?? "neutral"}>{state.replace(/_/g, " ")}</Pill>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-ink outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent-soft";
