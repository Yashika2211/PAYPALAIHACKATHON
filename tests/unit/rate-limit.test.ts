import { afterEach, describe, expect, it } from "vitest";
import { checkLimit, clientKey, limit, LIMITS, RateLimitError } from "@/lib/rate-limit";

describe("rate limiting", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT;
  });

  it("allows up to the limit, then rejects until the window passes", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMITS.extract.max; i++) checkLimit("203.0.113.9", "extract", t0 + i);
    expect(() => checkLimit("203.0.113.9", "extract", t0 + 100)).toThrow(RateLimitError);
    expect(() => checkLimit("203.0.113.9", "extract", t0 + LIMITS.extract.windowSeconds * 1000 + 10)).not.toThrow();
  });

  it("keeps clients and buckets separate", () => {
    for (let i = 0; i < LIMITS.onboard.max; i++) checkLimit("198.51.100.1", "onboard", 5);
    expect(() => checkLimit("198.51.100.2", "onboard", 5)).not.toThrow();
    expect(() => checkLimit("198.51.100.1", "plan", 5)).not.toThrow();
  });

  it("exempts loopback and can be switched off", () => {
    for (let i = 0; i < 50; i++) checkLimit("127.0.0.1", "invoice", 1);
    process.env.RATE_LIMIT = "off";
    for (let i = 0; i < 50; i++) checkLimit("192.0.2.7", "invoice", 1);
  });

  it("reads the client address from proxy headers", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.6" }))).toBe("203.0.113.6");
    expect(clientKey(new Headers())).toBe("local");
  });

  it("limits a Request by its forwarded client address", () => {
    const req = () => new Request("http://x/api", { headers: { "x-forwarded-for": "192.0.2.200" } });
    for (let i = 0; i < LIMITS.invoice.max; i++) limit(req(), "invoice");
    expect(() => limit(req(), "invoice")).toThrow(RateLimitError);
  });

  it("bounds memory under a flood of distinct clients", () => {
    for (let i = 0; i < 50_002; i++) checkLimit(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, "mcp", 1);
    // The map was cleared once it passed the bound, so an earlier client starts fresh.
    for (let i = 0; i < LIMITS.mcp.max; i++) checkLimit("10.0.0.0", "mcp", 2);
  });

  it("tells the user when to retry", () => {
    expect(new RateLimitError(90).message).toContain("2 minute(s)");
  });
});
