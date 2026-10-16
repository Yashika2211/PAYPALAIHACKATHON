ALTER TYPE "public"."order_state" ADD VALUE 'invoiced' BEFORE 'authorized';--> statement-breakpoint
ALTER TABLE "merchant_allocations" ADD COLUMN "delivered_at" timestamp with time zone;