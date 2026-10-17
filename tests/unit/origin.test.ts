import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/origin";

describe("publicOrigin", () => {
  afterEach(() => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
  });

  it("prefers explicit config, then Render's external URL", () => {
    process.env.RENDER_EXTERNAL_URL = "https://haggle-6xg1.onrender.com";
    expect(publicOrigin()).toBe("https://haggle-6xg1.onrender.com");
    process.env.PUBLIC_BASE_URL = "https://haggle.example/";
    expect(publicOrigin()).toBe("https://haggle.example");
  });

  it("uses forwarded headers behind a proxy instead of the internal URL", () => {
    const req = new Request("http://localhost:10000/api/mcp", { headers: { "x-forwarded-host": "haggle-6xg1.onrender.com", "x-forwarded-proto": "https" } });
    expect(publicOrigin(req)).toBe("https://haggle-6xg1.onrender.com");
  });

  it("falls back to the host header, then the request URL", () => {
    expect(publicOrigin(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }))).toBe("http://localhost:3000");
    expect(publicOrigin(new Request("http://127.0.0.1:3100/x"))).toBe("http://127.0.0.1:3100");
    expect(publicOrigin()).toBe("http://localhost:3000");
  });
});
