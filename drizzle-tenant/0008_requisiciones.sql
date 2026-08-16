CREATE TYPE "public"."requisition_status" AS ENUM('draft', 'submitted', 'approved', 'partial', 'ordered', 'rejected', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."requisition_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "requisition_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"deal_product_id" uuid,
	"part_id" uuid,
	"description" varchar(300) NOT NULL,
	"quantity" integer NOT NULL,
	"ordered_quantity" integer DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"supplier_reason" varchar(200),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"deal_id" uuid,
	"title" varchar(240) NOT NULL,
	"status" "requisition_status" DEFAULT 'draft' NOT NULL,
	"needed_by" date,
	"notes" text,
	"requested_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"resolution_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requisitions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "requisition_line_id" uuid;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_deal_product_id_crm_deal_products_id_fk" FOREIGN KEY ("deal_product_id") REFERENCES "public"."crm_deal_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_part_id_spare_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."spare_parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_deal_id_crm_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requisition_lines_requisition_idx" ON "requisition_lines" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "requisition_lines_part_idx" ON "requisition_lines" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "requisition_lines_supplier_idx" ON "requisition_lines" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "requisitions_status_idx" ON "requisitions" USING btree ("status","needed_by");--> statement-breakpoint
CREATE INDEX "requisitions_deal_idx" ON "requisitions" USING btree ("deal_id");--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requisition_line_id_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."requisition_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_requisition_idx" ON "purchase_order_lines" USING btree ("requisition_line_id");