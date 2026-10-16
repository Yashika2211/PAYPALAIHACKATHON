/**
 * Per-client sliding-window limits for the endpoints that spend AI quota.
 * In-memory (one web instance on Render); loopback is exempt so local tests run freely.
 */
export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`You're going a little fast. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`);
    this.name = "RateLimitError";
  }
}

const hits = new Map<string, number[]>();

export const LIMITS = {
  plan: { max: 12, windowSeconds: 600 },
  negotiate: { max: 8, windowSeconds: 600 },
  extract: { max: 6, windowSeconds: 600 },
  verify: { max: 15, windowSeconds: 600 },
  invoice: { max: 6, windowSeconds: 600 },
  onboard: { max: 5, windowSeconds: 600 },
  // MCP clients poll status, so this bucket is generous; tool calls still hit the same AI paths.
  mcp: { max: 240, windowSeconds: 600 },
} as const;
export type Bucket = keyof typeof LIMITS;

export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "local";
}

const isLoopback = (ip: string) => ip === "local" || ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1";

/** Throws RateLimitError when the client exceeds the bucket. Pure apart from the shared map. */
export function checkLimit(ip: string, bucket: Bucket, now = Date.now()) {
  if (process.env.RATE_LIMIT === "off" || isLoopback(ip)) return;
  const { max, windowSeconds } = LIMITS[bucket];
  const key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowSeconds * 1000);
  if (recent.length >= max) {
    hits.set(key, recent);
    throw new RateLimitError(windowSeconds - (now - recent[0]) / 1000);
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 50_000) hits.clear(); // crude memory bound
}

export function limit(req: Request, bucket: Bucket) {
  checkLimit(clientKey(req.headers), bucket);
}
