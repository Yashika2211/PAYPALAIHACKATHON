CREATE TABLE "events" (
	"seq" serial PRIMARY KEY NOT NULL,
	"rfq_id" uuid,
	"order_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
