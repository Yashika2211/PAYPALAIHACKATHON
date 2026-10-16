ALTER TABLE "payouts" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;