import { describe, expect, it } from "vitest";
import { checkInvoiceDraft } from "@/lib/agents/billing-agent";

const approved = {
  recipient: "buyer@example.com",
  lines: [
    { merchant: "Saffron", amountCents: 58_000 },
    { merchant: "Inkwell", amountCents: 12_400 },
  ],
};

describe("checkInvoiceDraft", () => {
  it("accepts the approved payer and amounts in any order and wording", () => {
    expect(checkInvoiceDraft({ recipient_email: " Buyer@Example.com ", items: [{ amount: "124.00" }, { amount: "580" }] }, approved)).toEqual([]);
  });

  it("rejects a different payer", () => {
    expect(checkInvoiceDraft({ recipient_email: "attacker@example.com", items: [{ amount: "580.00" }, { amount: "124.00" }] }, approved)).toEqual([
      "recipient must be buyer@example.com",
    ]);
  });

  it("rejects changed, extra, missing or nonsense amounts", () => {
    const expected = ["items must be exactly: Saffron 580.00, Inkwell 124.00"];
    expect(checkInvoiceDraft({ recipient_email: "buyer@example.com", items: [{ amount: "5800.00" }, { amount: "124.00" }] }, approved)).toEqual(expected);
    expect(checkInvoiceDraft({ recipient_email: "buyer@example.com", items: [{ amount: "580.00" }, { amount: "124.00" }, { amount: "1.00" }] }, approved)).toEqual(expected);
    expect(checkInvoiceDraft({ recipient_email: "buyer@example.com", items: [{ amount: "704.00" }] }, approved)).toEqual(expected);
    expect(checkInvoiceDraft({ recipient_email: "buyer@example.com", items: [{ amount: "abc" }, { amount: "124.00" }] }, approved)).toEqual(expected);
  });
});
