/**
 * Runs once per server start. On Render's free plan (no cron jobs) the web service
 * sweeps expired mandates and stale PayPal holds itself every 30 minutes.
 * Disable with HOLD_SWEEP=off when a separate cron job is configured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.HOLD_SWEEP === "off" || process.env.NODE_ENV !== "production") return;
  const { expireAndRelease } = await import("./lib/maintenance");
  const sweep = () =>
    expireAndRelease()
      .then((r) => (r.expiredMandates || r.staleHolds || r.payoutsRetried || r.payoutsReconciled) && console.log("[maintenance]", r))
      .catch((err) => console.error("[maintenance]", err instanceof Error ? err.message : err));
  setTimeout(sweep, 60_000);
  setInterval(sweep, 30 * 60_000).unref();
}
