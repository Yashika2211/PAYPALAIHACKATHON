import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  canTransition,
  deriveSettlementState,
  transition,
} from "@/lib/state/order-machine";

describe("order state machine", () => {
  it("walks the happy path", () => {
    let s = transition("draft", "quoted");
    s = transition(s, "mandate_signed");
    s = transition(s, "authorized");
    s = transition(s, "partially_captured");
    s = transition(s, "partially_captured");
    s = transition(s, "settled");
    expect(transition(s, "refunded")).toBe("refunded");
  });

  it("treats repeats as no-ops (idempotent webhooks)", () => {
    expect(transition("authorized", "authorized")).toBe("authorized");
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("draft", "settled")).toBe(false);
    expect(() => transition("voided", "authorized")).toThrow(IllegalTransitionError);
    expect(() => transition("draft", "settled")).toThrow("Illegal order transition draft -> settled");
  });
});

describe("deriveSettlementState", () => {
  it.each([
    [[], null],
    [["pending", "pending"], null],
    [["authorized", "pending"], "authorized"],
    [["authorized", "authorized"], "authorized"],
    [["captured", "authorized"], "partially_captured"],
    [["captured", "pending"], "partially_captured"],
    [["captured", "captured"], "settled"],
    [["captured", "voided"], "settled"],
    [["captured", "refunded"], "settled"],
    [["voided", "voided"], "voided"],
    [["refunded", "voided"], "refunded"],
    [["refunded"], "refunded"],
    [["refunded", "authorized"], "partially_captured"],
  ] as const)("%j -> %s", (allocs, expected) => {
    expect(deriveSettlementState(allocs)).toBe(expected);
  });
});
