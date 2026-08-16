CREATE TYPE "public"."ml_model_status" AS ENUM('backtested', 'production', 'retired', 'rejected');--> statement-breakpoint
CREATE TABLE "ml_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template" varchar(60) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "ml_model_status" DEFAULT 'backtested' NOT NULL,
	"algorithm" varchar(60) NOT NULL,
	"params" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"beats_baseline" boolean NOT NULL,
	"trained_up_to" timestamp with time zone,
	"trained_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trained_by_id" uuid,
	"promoted_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "ml_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"actual" numeric(12, 2) NOT NULL,
	"error" numeric(12, 2) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"subject_type" varchar(40) NOT NULL,
	"subject_id" uuid NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"lower" numeric(12, 2),
	"upper" numeric(12, 2),
	"support" integer,
	"features" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ml_models" ADD CONSTRAINT "ml_models_trained_by_id_users_id_fk" FOREIGN KEY ("trained_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml_outcomes" ADD CONSTRAINT "ml_outcomes_prediction_id_ml_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."ml_predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml_predictions" ADD CONSTRAINT "ml_predictions_model_id_ml_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ml_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ml_models_template_idx" ON "ml_models" USING btree ("template","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_models_template_version_uq" ON "ml_models" USING btree ("template","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_outcomes_prediction_uq" ON "ml_outcomes" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "ml_outcomes_recorded_idx" ON "ml_outcomes" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "ml_predictions_subject_idx" ON "ml_predictions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ml_predictions_model_idx" ON "ml_predictions" USING btree ("model_id","created_at");