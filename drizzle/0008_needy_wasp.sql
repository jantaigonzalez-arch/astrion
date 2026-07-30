CREATE TABLE "settings" (
	"id" varchar(20) PRIMARY KEY DEFAULT 'global' NOT NULL,
	"labor_cost_per_hour" numeric(12, 2),
	"labor_rate_per_hour" numeric(12, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_comment_parts" ADD COLUMN "unit_price_mxn" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "ticket_comment_parts" ADD COLUMN "unit_price_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "spare_parts" ADD COLUMN "price_mxn" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "spare_parts" ADD COLUMN "price_usd" numeric(12, 2);