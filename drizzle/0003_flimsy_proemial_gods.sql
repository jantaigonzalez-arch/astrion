CREATE TYPE "public"."ticket_type" AS ENUM('request', 'service');--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'pending_review' BEFORE 'open';--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "type" "ticket_type" DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;