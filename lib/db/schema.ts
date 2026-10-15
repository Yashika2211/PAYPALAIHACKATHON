import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// All money is integer cents, USD.

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const merchantPersonality = pgEnum("merchant_personality", ["friendly", "firm", "upsell"]);
export const merchantStatus = pgEnum("merchant_status", ["draft", "live", "quarantined"]);

export const merchants = pgTable("merchants", {
  id: id(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tagline: text("tagline").notNull().default(""),
  personality: merchantPersonality("personality").notNull().default("friendly"),
  payoutEmail: text("payout_email").notNull(),
  minMarginPct: integer("min_margin_pct").notNull().default(15),
  maxDiscountPct: integer("max_discount_pct").notNull().default(15),
  leadTimeHours: integer("lead_time_hours").notNull().default(24),
  dailyCapacity: integer("daily_capacity").notNull().default(100),
  status: merchantStatus("status").notNull().default("live"),
  // Seeded rogue merchant used to demo the Mandate Firewall.
  isRogue: boolean("is_rogue").notNull().default(false),
  ...timestamps,
});

export const catalogItems = pgTable("catalog_items", {
  id: id(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  listPriceCents: integer("list_price_cents").notNull(),
  // Never sent to an LLM. Enforced by the negotiation engine.
  floorPriceCents: integer("floor_price_cents").notNull(),
  category: text("category").notNull(),
  dietaryTags: text("dietary_tags").array().notNull().default([]),
  leadTimeHours: integer("lead_time_hours").notNull().default(24),
  extractionConfidence: real("extraction_confidence"),
  ...timestamps,
});

export const rfqStatus = pgEnum("rfq_status", ["planning", "negotiating", "bundled", "closed"]);

export const rfqs = pgTable("rfqs", {
  id: id(),
  buyerEmail: text("buyer_email").notNull(),
  rawRequest: text("raw_request").notNull(),
  // [{ name, category, quantity, unit, notes }]
  lineItems: jsonb("line_items").notNull().default([]),
  budgetHintCents: integer("budget_hint_cents"),
  deadline: timestamp("deadline", { withTimezone: true }),
  status: rfqStatus("status").notNull().default("planning"),
  ...timestamps,
});

export const mandateStatus = pgEnum("mandate_status", ["active", "expired", "revoked", "exhausted"]);

export const mandates = pgTable("mandates", {
  id: id(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id, { onDelete: "cascade" }),
  buyerEmail: text("buyer_email").notNull(),
  budgetCapCents: integer("budget_cap_cents").notNull(),
  allowedCategories: text("allowed_categories").array().notNull(),
  allowedMerchantIds: text("allowed_merchant_ids").array().notNull(),
  approvalThresholdCents: integer("approval_threshold_cents").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  // HMAC-SHA256 over the canonical mandate terms.
  signature: text("signature").notNull(),
  spentCents: integer("spent_cents").notNull().default(0),
  status: mandateStatus("status").notNull().default("active"),
  ...timestamps,
});

export const negotiationStatus = pgEnum("negotiation_status", [
  "open",
  "accepted",
  "rejected",
  "timeout",
  "quarantined",
]);

export const negotiations = pgTable("negotiations", {
  id: id(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id, { onDelete: "cascade" }),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  roundCount: integer("round_count").notNull().default(0),
  status: negotiationStatus("status").notNull().default("open"),
  ...timestamps,
});

export const offerSide = pgEnum("offer_side", ["buyer", "merchant"]);

export const offers = pgTable("offers", {
  id: id(),
  negotiationId: uuid("negotiation_id")
    .notNull()
    .references(() => negotiations.id, { onDelete: "cascade" }),
  round: integer("round").notNull(),
  side: offerSide("side").notNull(),
  // Typed Offer (lib/agents/protocol.ts).
  payload: jsonb("payload").notNull(),
  totalCents: integer("total_cents").notNull(),
  message: text("message").notNull().default(""),
  rawLlmOutput: text("raw_llm_output"),
  ...timestamps,
});

export const orderState = pgEnum("order_state", [
  "draft",
  "quoted",
  "mandate_signed",
  "authorized",
  "partially_captured",
  "settled",
  "voided",
  "refunded",
]);

export const orders = pgTable("orders", {
  id: id(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id),
  mandateId: uuid("mandate_id").references(() => mandates.id),
  paypalOrderId: text("paypal_order_id").unique(),
  paypalAuthorizationId: text("paypal_authorization_id"),
  state: orderState("state").notNull().default("draft"),
  totalCents: integer("total_cents").notNull(),
  firstQuoteTotalCents: integer("first_quote_total_cents"),
  platformFeeBps: integer("platform_fee_bps").notNull().default(300),
  rationale: text("rationale").notNull().default(""),
  ...timestamps,
});

export const allocationState = pgEnum("allocation_state", [
  "pending",
  "authorized",
  "captured",
  "voided",
  "refunded",
]);

// One row per merchant in a bundle. PayPal holds one authorization per order
// (multi-unit AUTHORIZE is unsupported), and each allocation is captured separately.
export const merchantAllocations = pgTable("merchant_allocations", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  offerId: uuid("offer_id").references(() => offers.id),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  state: allocationState("state").notNull().default("pending"),
  paypalCaptureId: text("paypal_capture_id").unique(),
  captureRequestId: text("capture_request_id"),
  deliveryPhotoUrl: text("delivery_photo_url"),
  verifierResult: jsonb("verifier_result"),
  ...timestamps,
});

export const paypalEvents = pgTable("paypal_events", {
  id: id(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  raw: jsonb("raw").notNull(),
  signatureVerified: boolean("signature_verified").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  ...timestamps,
});

export const paypalApiCalls = pgTable("paypal_api_calls", {
  id: id(),
  orderId: uuid("order_id"),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestId: text("request_id"),
  status: integer("status").notNull(),
  request: jsonb("request"),
  response: jsonb("response"),
  durationMs: integer("duration_ms").notNull(),
  ...timestamps,
});

export const payoutStatus = pgEnum("payout_status", ["pending", "succeeded", "failed", "unclaimed"]);

export const payouts = pgTable("payouts", {
  id: id(),
  allocationId: uuid("allocation_id")
    .notNull()
    .unique()
    .references(() => merchantAllocations.id),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  grossCents: integer("gross_cents").notNull(),
  feeCents: integer("fee_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  status: payoutStatus("status").notNull().default("pending"),
  ...timestamps,
});

// Append-only feed that drives the live UI (SSE polls by serial id, so it works across processes).
export const events = pgTable("events", {
  seq: serial("seq").primaryKey(),
  rfqId: uuid("rfq_id"),
  orderId: uuid("order_id"),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const firewallDecision = pgEnum("firewall_decision", ["allow", "deny", "needs_human"]);

export const firewallDecisions = pgTable("firewall_decisions", {
  id: id(),
  mandateId: uuid("mandate_id"),
  rfqId: uuid("rfq_id"),
  actor: text("actor").notNull(),
  action: jsonb("action").notNull(),
  decision: firewallDecision("decision").notNull(),
  reasons: text("reasons").array().notNull(),
  injectionFlags: text("injection_flags").array().notNull().default([]),
  ...timestamps,
});

// Last good structured answer per input, replayed only when every live model fails.
export const llmCache = pgTable("llm_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
