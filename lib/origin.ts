/**
 * The public origin users see. Behind Render's proxy the request URL is internal
 * (e.g. http://localhost:10000), so prefer explicit config, then Render's own
 * RENDER_EXTERNAL_URL, then the proxy's forwarded headers.
 */
export function publicOrigin(req?: Request): string {
  const configured = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    if (host) return `${proto}://${host}`;
    return new URL(req.url).origin;
  }
  return "http://localhost:3000";
}
