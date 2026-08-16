CREATE TABLE "ml_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"label" varchar(120) NOT NULL,
	"question" text NOT NULL,
	"subject" varchar(40) NOT NULL,
	"target" varchar(40) NOT NULL,
	"features" jsonb NOT NULL,
	"tolerance" numeric(12, 2) NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ml_templates" ADD CONSTRAINT "ml_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ml_templates_slug_uq" ON "ml_templates" USING btree ("slug");