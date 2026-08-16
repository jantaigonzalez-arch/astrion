CREATE TYPE "public"."signup_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "tenant_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(160) NOT NULL,
	"desired_slug" varchar(40),
	"contact_name" varchar(160) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(40),
	"size" varchar(40),
	"industry" varchar(120),
	"note" text,
	"locale" varchar(5) DEFAULT 'es' NOT NULL,
	"status" "signup_status" DEFAULT 'pending' NOT NULL,
	"tenant_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_signups" ADD CONSTRAINT "tenant_signups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_signups" ADD CONSTRAINT "tenant_signups_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_signups_status_idx" ON "tenant_signups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tenant_signups_email_idx" ON "tenant_signups" USING btree ("email");