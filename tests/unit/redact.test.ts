import { describe, expect, it } from "vitest";
import { redact } from "@/lib/paypal/redact";

describe("redact", () => {
  it("removes secrets and card data, masks emails and tokens", () => {
    const out = redact({
      access_token: "A21AA",
      payment_source: { card: { number: "4111111111111111", security_code: "123", expiry: "2030-12", name: "Buyer", vault_id: "29m98912ra5917238" } },
      payer: { email_address: "buyer@example.com" },
      items: [{ receiver: "merchant@example.com", note: "hi" }, 3, null],
      short: { number: "12", vault_id: "abc", email: "nodomain" },
    });
    expect(out).toEqual({
      access_token: "[redacted]",
      payment_source: { card: { number: "•••• 1111", security_code: "[redacted]", expiry: "203…12", name: "Buyer", vault_id: "29m…38" } },
      payer: { email_address: "bu***@example.com" },
      items: [{ receiver: "me***@example.com", note: "hi" }, 3, null],
      short: { number: "[redacted]", vault_id: "[redacted]", email: "***" },
    });
  });

  it("passes primitives through", () => {
    expect(redact("x")).toBe("x");
    expect(redact(7)).toBe(7);
  });
});
