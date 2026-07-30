CREATE TABLE "crm_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"trigger_stage_id" uuid NOT NULL,
	"activity_type" "crm_activity_type" DEFAULT 'call' NOT NULL,
	"activity_subject" varchar(240) NOT NULL,
	"due_in_days" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_deal_labels" (
	"deal_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "crm_deal_labels_deal_id_label_id_pk" PRIMARY KEY("deal_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "crm_deal_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"product_id" uuid,
	"part_id" uuid,
	"name" varchar(300) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_mxn" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"owner_id" uuid,
	"pipeline_id" uuid,
	"metric" varchar(20) DEFAULT 'revenue' NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(20) DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_stages" ADD COLUMN "rotting_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_trigger_stage_id_crm_stages_id_fk" FOREIGN KEY ("trigger_stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_labels" ADD CONSTRAINT "crm_deal_labels_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_labels" ADD CONSTRAINT "crm_deal_labels_label_id_crm_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."crm_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_products" ADD CONSTRAINT "crm_deal_products_part_id_spare_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."spare_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_email_templates" ADD CONSTRAINT "crm_email_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_goals" ADD CONSTRAINT "crm_goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_goals" ADD CONSTRAINT "crm_goals_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE cascade ON UPDATE no action;