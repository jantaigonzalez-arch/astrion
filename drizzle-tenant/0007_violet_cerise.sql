CREATE TYPE "public"."supplier_advance_status" AS ENUM('open', 'applied', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_advance_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "supplier_advance_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"applied_at" date NOT NULL,
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'MXN' NOT NULL,
	"method" "payment_method" DEFAULT 'transfer' NOT NULL,
	"payment_reference" varchar(120),
	"paid_at" date NOT NULL,
	"cfdi_uuid" varchar(36),
	"status" "supplier_advance_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_advances_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"due_at" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "suspended_by_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_advance_applications" ADD CONSTRAINT "supplier_advance_applications_advance_id_supplier_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."supplier_advances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_advance_applications" ADD CONSTRAINT "supplier_advance_applications_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_advance_applications" ADD CONSTRAINT "supplier_advance_applications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_advances" ADD CONSTRAINT "supplier_advances_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_installments" ADD CONSTRAINT "supplier_invoice_installments_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saa_invoice_idx" ON "supplier_advance_applications" USING btree ("invoice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "saa_advance_idx" ON "supplier_advance_applications" USING btree ("advance_id","occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_advances_supplier_idx" ON "supplier_advances" USING btree ("supplier_id","paid_at");--> statement-breakpoint
CREATE INDEX "supplier_advances_status_idx" ON "supplier_advances" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_advances_cfdi_uq" ON "supplier_advances" USING btree ("cfdi_uuid") WHERE "supplier_advances"."cfdi_uuid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sii_invoice_seq_uq" ON "supplier_invoice_installments" USING btree ("invoice_id","seq");--> statement-breakpoint
CREATE INDEX "sii_due_idx" ON "supplier_invoice_installments" USING btree ("due_at");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_suspended_by_id_users_id_fk" FOREIGN KEY ("suspended_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppliers_suspended_idx" ON "suppliers" USING btree ("suspended_at");