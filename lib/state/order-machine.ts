export type OrderState =
  | "draft"
  | "quoted"
  | "mandate_signed"
  | "authorized"
  | "partially_captured"
  | "settled"
  | "voided"
  | "refunded";

export type AllocationState = "pending" | "authorized" | "captured" | "voided" | "refunded";

const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  draft: ["quoted"],
  quoted: ["mandate_signed", "voided"],
  mandate_signed: ["authorized", "voided"],
  authorized: ["partially_captured", "settled", "voided"],
  partially_captured: ["partially_captured", "settled", "refunded"],
  settled: ["refunded"],
  voided: [],
  refunded: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderState,
    readonly to: OrderState,
  ) {
    super(`Illegal order transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** Returns `to` if legal, `from` if it is a no-op repeat, otherwise throws. */
export function transition(from: OrderState, to: OrderState): OrderState {
  if (from === to && to !== "partially_captured") return from;
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return to;
}

/**
 * Derives the post-authorization order state from its merchant allocations.
 * Returns null while nothing has been authorized yet.
 */
export function deriveSettlementState(allocations: readonly AllocationState[]): OrderState | null {
  if (allocations.length === 0) return null;
  const count = (s: AllocationState) => allocations.filter((a) => a === s).length;
  const captured = count("captured");
  const voided = count("voided");
  const refunded = count("refunded");
  const open = count("authorized");

  if (count("pending") === allocations.length) return null;
  if (refunded > 0 && captured === 0 && open === 0) return "refunded";
  if (voided === allocations.length) return "voided";
  if (open > 0 || count("pending") > 0) return captured + refunded > 0 ? "partially_captured" : "authorized";
  // Every allocation is closed, not all voided, and not refund-only: at least one capture stands.
  return "settled";
}

export const TERMINAL_STATES: readonly OrderState[] = ["settled", "voided", "refunded"];
