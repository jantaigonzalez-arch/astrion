CREATE TABLE "analytics_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_event_id" bigint NOT NULL,
	"to_event_id" bigint NOT NULL,
	"rows" integer NOT NULL,
	"path" varchar(300) NOT NULL,
	"bytes" integer NOT NULL,
	"consented_at_extraction" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_snapshots_tenant_idx" ON "analytics_snapshots" USING btree ("tenant_id","to_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshots_range_idx" ON "analytics_snapshots" USING btree ("tenant_id","to_event_id");