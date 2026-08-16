CREATE TYPE "public"."payment_method" AS ENUM('transfer', 'cash', 'check', 'card', 'other');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('pending', 'partial', 'paid', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_invoice_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "supplier_invoice_orders" (
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	CONSTRAINT "supplier_invoice_orders_invoice_id_order_id_pk" PRIMARY KEY("invoice_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_folio" varchar(60),
	"cfdi_uuid" varchar(36),
	"currency" varchar(3) DEFAULT 'MXN' NOT NULL,
	"fx_rate" numeric(18, 8),
	"fx_date" date,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"issued_at" date NOT NULL,
	"due_at" date NOT NULL,
	"status" "supplier_invoice_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"method" "payment_method" DEFAULT 'transfer' NOT NULL,
	"reference" varchar(120),
	"paid_at" date NOT NULL,
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice_orders" ADD CONSTRAINT "supplier_invoice_orders_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_orders" ADD CONSTRAINT "supplier_invoice_orders_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_invoice_orders_order_idx" ON "supplier_invoice_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_supplier_idx" ON "supplier_invoices" USING btree ("supplier_id","issued_at");--> statement-breakpoint
CREATE INDEX "supplier_invoices_due_idx" ON "supplier_invoices" USING btree ("due_at","status");--> statement-breakpoint
CREATE INDEX "supplier_invoices_status_idx" ON "supplier_invoices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_cfdi_uq" ON "supplier_invoices" USING btree ("cfdi_uuid") WHERE "supplier_invoices"."cfdi_uuid" is not null;--> statement-breakpoint
CREATE INDEX "supplier_payments_invoice_idx" ON "supplier_payments" USING btree ("invoice_id","occurred_at");