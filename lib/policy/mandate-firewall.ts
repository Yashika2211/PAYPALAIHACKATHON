import { scanForInjection } from "./injection";

/**
 * The Mandate Firewall. A pure function: no LLM, no I/O, no clock reads.
 * The LLM proposes; this decides.
 */

export type Decision = "allow" | "deny" | "needs_human";
export type Actor = "buyer_agent" | "merchant_agent" | "human" | "system";

export interface MandateView {
  id: string;
  status: "active" | "expired" | "revoked" | "exhausted";
  budgetCapCents: number;
  spentCents: number;
  allowedCategories: readonly string[];
  allowedMerchantIds: readonly string[];
  approvalThresholdCents: number;
  expiresAt: Date;
}

export type Action =
  | { type: "send_rfq"; merchantId: string; category: string }
  | { type: "propose_offer"; merchantId: string; totalCents: number; message: string }
  | { type: "counter_offer"; merchantId: string; totalCents: number }
  | { type: "accept_offer"; merchantId: string; category: string; totalCents: number }
  | {
      type: "authorize_payment";
      amountCents: number;
      lines: ReadonlyArray<{ merchantId: string; category: string; amountCents: number }>;
    }
  | {
      /** Bill the buyer by PayPal invoice instead of holding funds. */
      type: "request_invoice";
      amountCents: number;
      lines: ReadonlyArray<{ merchantId: string; category: string; amountCents: number }>;
      /** Set by server code from the buyer's recorded click, never from model output. */
      humanApproved: boolean;
    }
  | { type: "capture_payment"; merchantId: string; amountCents: number; deliveryVerified: boolean }
  | { type: "void_authorization" }
  | { type: "refund"; amountCents: number };

export interface FirewallContext {
  actor: Actor;
  now: Date;
  /** Result of verifying the stored HMAC against the stored terms. */
  signatureValid: boolean;
  quarantinedMerchantIds: readonly string[];
}

export interface FirewallResult {
  decision: Decision;
  reasons: string[];
  injectionFlags: string[];
  /** Set when the firewall wants the offending merchant quarantined. */
  quarantineMerchantId?: string;
}

const ACTOR_PERMISSIONS: Record<Actor, ReadonlyArray<Action["type"]>> = {
  merchant_agent: ["propose_offer"],
  buyer_agent: ["send_rfq", "counter_offer", "accept_offer", "authorize_payment", "request_invoice"],
  human: ["authorize_payment", "request_invoice", "capture_payment", "void_authorization", "refund", "accept_offer"],
  system: ["capture_payment", "void_authorization", "refund"],
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function merchantOf(action: Action): string | undefined {
  return "merchantId" in action ? action.merchantId : undefined;
}

export function evaluate(mandate: MandateView | null, action: Action, ctx: FirewallContext): FirewallResult {
  const deny: string[] = [];
  const human: string[] = [];
  let injectionFlags: string[] = [];
  let quarantineMerchantId: string | undefined;

  // Actions that only ever reduce what the buyer pays are always allowed for trusted actors.
  const releasesFunds = action.type === "void_authorization" || action.type === "refund";

  if (!ACTOR_PERMISSIONS[ctx.actor].includes(action.type)) {
    deny.push(`${ctx.actor} is not permitted to ${action.type}`);
  }

  if (!mandate) {
    deny.push("no signed mandate on file");
  } else if (!releasesFunds) {
    if (!ctx.signatureValid) deny.push("mandate signature is invalid (terms were altered)");
    if (mandate.status !== "active") deny.push(`mandate is ${mandate.status}`);
    if (ctx.now.getTime() >= mandate.expiresAt.getTime()) deny.push("mandate has expired");
  }

  const merchantId = merchantOf(action);
  if (merchantId && ctx.quarantinedMerchantIds.includes(merchantId)) {
    deny.push(`merchant ${merchantId} is quarantined`);
  }
  if (mandate && merchantId && !mandate.allowedMerchantIds.includes(merchantId)) {
    deny.push(`merchant ${merchantId} is not allowed by the mandate`);
  }

  if (mandate) {
    const remaining = mandate.budgetCapCents - mandate.spentCents;
    switch (action.type) {
      case "send_rfq":
      case "accept_offer":
        if (!mandate.allowedCategories.includes(action.category)) {
          deny.push(`category "${action.category}" is not allowed by the mandate`);
        }
        if (action.type === "accept_offer" && action.totalCents > remaining) {
          deny.push(`offer ${usd(action.totalCents)} exceeds remaining budget ${usd(remaining)}`);
        }
        break;
      case "propose_offer": {
        const findings = scanForInjection(action.message);
        if (findings.length > 0) {
          injectionFlags = findings.map((f) => f.rule);
          deny.push(`instruction-like content in merchant message (${injectionFlags.join(", ")})`);
          quarantineMerchantId = action.merchantId;
        }
        break;
      }
      case "authorize_payment":
      case "request_invoice": {
        const sum = action.lines.reduce((s, l) => s + l.amountCents, 0);
        if (sum !== action.amountCents) deny.push("line items do not add up to the authorization amount");
        if (action.amountCents <= 0) deny.push("authorization amount must be positive");
        if (action.amountCents > remaining) {
          deny.push(`authorization ${usd(action.amountCents)} exceeds remaining budget ${usd(remaining)}`);
        }
        for (const line of action.lines) {
          if (!mandate.allowedMerchantIds.includes(line.merchantId)) {
            deny.push(`merchant ${line.merchantId} is not allowed by the mandate`);
          }
          if (ctx.quarantinedMerchantIds.includes(line.merchantId)) {
            deny.push(`merchant ${line.merchantId} is quarantined`);
          }
          if (!mandate.allowedCategories.includes(line.category)) {
            deny.push(`category "${line.category}" is not allowed by the mandate`);
          }
        }
        const approved = ctx.actor === "human" || (action.type === "request_invoice" && action.humanApproved);
        if (!approved && action.amountCents > mandate.approvalThresholdCents) {
          human.push(
            `${usd(action.amountCents)} is above the auto-approve threshold of ${usd(mandate.approvalThresholdCents)}`,
          );
        }
        break;
      }
      case "capture_payment":
        if (!action.deliveryVerified && ctx.actor !== "human") {
          human.push("delivery has not been verified");
        }
        if (action.amountCents <= 0) deny.push("capture amount must be positive");
        break;
      case "counter_offer":
      case "void_authorization":
      case "refund":
        break;
    }
  }

  if (deny.length > 0) return { decision: "deny", reasons: deny, injectionFlags, quarantineMerchantId };
  if (human.length > 0) return { decision: "needs_human", reasons: human, injectionFlags };
  return { decision: "allow", reasons: ["within mandate"], injectionFlags };
}
