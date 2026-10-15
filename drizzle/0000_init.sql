CREATE TYPE "public"."allocation_state" AS ENUM('pending', 'authorized', 'captured', 'voided', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."firewall_decision" AS ENUM('allow', 'deny', 'needs_human');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('active', 'expired', 'revoked', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."merchant_personality" AS ENUM('friendly', 'firm', 'upsell');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('draft', 'live', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."negotiation_status" AS ENUM('open', 'accepted', 'rejected', 'timeout', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."offer_side" AS ENUM('buyer', 'merchant');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('draft', 'quoted', 'mandate_signed', 'authorized', 'partially_captured', 'settled', 'voided', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'succeeded', 'failed', 'unclaimed');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('planning', 'negotiating', 'bundled', 'closed');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"list_price_cents" integer NOT NULL,
	"floor_price_cents" integer NOT NULL,
	"category" text NOT NULL,
	"dietary_tags" text[] DEFAULT '{}' NOT NULL,
	"lead_time_hours" integer DEFAULT 24 NOT NULL,
	"extraction_confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firewall_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid,
	"rfq_id" uuid,
	"actor" text NOT NULL,
	"action" jsonb NOT NULL,
	"decision" "firewall_decision" NOT NULL,
	"reasons" text[] NOT NULL,
	"injection_flags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"buyer_email" text NOT NULL,
	"budget_cap_cents" integer NOT NULL,
	"allowed_categories" text[] NOT NULL,
	"allowed_merchant_ids" text[] NOT NULL,
	"approval_threshold_cents" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"offer_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"state" "allocation_state" DEFAULT 'pending' NOT NULL,
	"paypal_capture_id" text,
	"capture_request_id" text,
	"delivery_photo_url" text,
	"verifier_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_allocations_paypal_capture_id_unique" UNIQUE("paypal_capture_id")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"personality" "merchant_personality" DEFAULT 'friendly' NOT NULL,
	"payout_email" text NOT NULL,
	"min_margin_pct" integer DEFAULT 15 NOT NULL,
	"max_discount_pct" integer DEFAULT 15 NOT NULL,
	"lead_time_hours" integer DEFAULT 24 NOT NULL,
	"daily_capacity" integer DEFAULT 100 NOT NULL,
	"status" "merchant_status" DEFAULT 'live' NOT NULL,
	"is_rogue" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"round_count" integer DEFAULT 0 NOT NULL,
	"status" "negotiation_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"side" "offer_side" NOT NULL,
	"payload" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"raw_llm_output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"mandate_id" uuid,
	"paypal_order_id" text,
	"paypal_authorization_id" text,
	"state" "order_state" DEFAULT 'draft' NOT NULL,
	"total_cents" integer NOT NULL,
	"first_quote_total_cents" integer,
	"platform_fee_bps" integer DEFAULT 300 NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_paypal_order_id_unique" UNIQUE("paypal_order_id")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"payout_batch_id" text,
	"payout_item_id" text,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_allocation_id_unique" UNIQUE("allocation_id")
);
--> statement-breakpoint
CREATE TABLE "paypal_api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_id" text,
	"status" integer NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"raw" jsonb NOT NULL,
	"signature_verified" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_email" text NOT NULL,
	"raw_request" text NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_hint_cents" integer,
	"deadline" timestamp with time zone,
	"status" "rfq_status" DEFAULT 'planning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_allocations" ADD CONSTRAINT "merchant_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_allocations" ADD CONSTRAINT "merchant_allocations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_allocations" ADD CONSTRAINT "merchant_allocations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_allocation_id_merchant_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."merchant_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;