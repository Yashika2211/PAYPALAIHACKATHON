CREATE TABLE "buyer_vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_email" text NOT NULL,
	"paypal_customer_id" text NOT NULL,
	"vault_id" text NOT NULL,
	"brand" text,
	"last_digits" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_vault_buyer_email_unique" UNIQUE("buyer_email")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paypal_invoice_id" text;