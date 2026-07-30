CREATE TYPE "public"."inventory_movement_kind" AS ENUM('opening', 'consumption', 'purchase', 'return', 'adjustment');--> statement-breakpoint
CREATE SEQUENCE "public"."crm_deal_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."ticket_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"legal_name" varchar(240),
	"tax_id" varchar(20),
	"functional_currency" varchar(3) DEFAULT 'MXN' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggregate_type" varchar(60) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"company_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_date" date NOT NULL,
	"base_currency" varchar(3) NOT NULL,
	"quote_currency" varchar(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"company_id" uuid,
	"kind" "inventory_movement_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ticket_comment_id" uuid,
	"unit_cost_mxn" numeric(12, 2),
	"unit_cost_usd" numeric(12, 2),
	"note" text,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "fx_date" date;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "fx_date" date;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_organizations" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_part_id_spare_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."spare_parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ticket_comment_id_ticket_comments_id_fk" FOREIGN KEY ("ticket_comment_id") REFERENCES "public"."ticket_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_unique_idx" ON "fx_rates" USING btree ("quote_date","base_currency","quote_currency");--> statement-breakpoint
CREATE INDEX "inventory_movements_part_idx" ON "inventory_movements" USING btree ("part_id","occurred_at");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organizations" ADD CONSTRAINT "crm_organizations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

/* ================================================================
 * Pasos de datos (escritos a mano: drizzle-kit no puede inferirlos)
 * ================================================================ */

/* 1. Arranca las secuencias de folio donde terminó count(*)+1, para que no
 *    haya discontinuidad con los folios ya emitidos. `is_called = false`
 *    hace que el próximo nextval devuelva exactamente este valor.
 *    El patrón '^EVO-[0-9]+$' excluye a propósito los 'EVO-D-…' de negocios. */
SELECT setval(
  'ticket_reference_seq',
  COALESCE(
    (SELECT MAX(regexp_replace(reference, '^EVO-', '')::int)
       FROM tickets WHERE reference ~ '^EVO-[0-9]+$'),
    0
  ) + 1,
  false
);--> statement-breakpoint

SELECT setval(
  'crm_deal_reference_seq',
  COALESCE(
    (SELECT MAX(regexp_replace(reference, '^EVO-D-', '')::int)
       FROM crm_deals WHERE reference ~ '^EVO-D-[0-9]+$'),
    0
  ) + 1,
  false
);--> statement-breakpoint

/* 2. Saldo inicial del ledger: un movimiento 'opening' por cada refacción con
 *    existencia, para que spare_parts.stock cuadre con la suma de movimientos
 *    desde el primer día. Sin esto el stock actual no tendría respaldo. */
INSERT INTO "inventory_movements" ("part_id", "kind", "quantity", "balance_after", "note")
SELECT "id", 'opening', "stock", "stock",
       'Saldo inicial al migrar el catálogo al ledger de inventario'
  FROM "spare_parts"
 WHERE "stock" <> 0;--> statement-breakpoint

/* 3. Empresa por defecto. legal_name y tax_id (RFC) quedan NULL a propósito:
 *    son datos fiscales reales que debe capturar el negocio, no inventarse. */
INSERT INTO "companies" ("name")
SELECT 'Evoelution'
 WHERE NOT EXISTS (SELECT 1 FROM "companies");--> statement-breakpoint

UPDATE "tickets" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "crm_deals" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "crm_organizations" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "contracts" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "spare_parts" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "inventory_movements" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY "created_at" LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint

/* 4. domain_events es append-only, y se hace cumplir en la base y no solo por
 *    convención: una bitácora de auditoría que la aplicación puede reescribir
 *    no sirve como evidencia. Si algún día hay que purgar por retención, se
 *    quita el trigger deliberadamente en una migración propia. */
CREATE OR REPLACE FUNCTION "domain_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'domain_events es append-only: % no está permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "domain_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "domain_events"
  FOR EACH ROW EXECUTE FUNCTION "domain_events_append_only"();