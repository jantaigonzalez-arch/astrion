CREATE TYPE "public"."payable_import_kind" AS ENUM('charges_csv', 'credits_csv', 'charges_cfdi');--> statement-breakpoint
CREATE TYPE "public"."supplier_credit_note_status" AS ENUM('open', 'applied', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."payable_import_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_credit_note_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "payable_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"kind" "payable_import_kind" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"row_count" integer NOT NULL,
	"ok_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payable_imports_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_note_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"applied_at" date NOT NULL,
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_folio" varchar(60),
	"cfdi_uuid" varchar(36),
	"currency" varchar(3) DEFAULT 'MXN' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"issued_at" date NOT NULL,
	"status" "supplier_credit_note_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_credit_notes_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "payable_imports" ADD CONSTRAINT "payable_imports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note_applications" ADD CONSTRAINT "supplier_credit_note_applications_credit_note_id_supplier_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."supplier_credit_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note_applications" ADD CONSTRAINT "supplier_credit_note_applications_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note_applications" ADD CONSTRAINT "supplier_credit_note_applications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payable_imports_created_idx" ON "payable_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scna_invoice_idx" ON "supplier_credit_note_applications" USING btree ("invoice_id","occurred_at");--> statement-breakpoint
CREATE INDEX "scna_note_idx" ON "supplier_credit_note_applications" USING btree ("credit_note_id","occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_credit_notes_supplier_idx" ON "supplier_credit_notes" USING btree ("supplier_id","issued_at");--> statement-breakpoint
CREATE INDEX "supplier_credit_notes_status_idx" ON "supplier_credit_notes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credit_notes_cfdi_uq" ON "supplier_credit_notes" USING btree ("cfdi_uuid") WHERE "supplier_credit_notes"."cfdi_uuid" is not null;