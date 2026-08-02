/* La bitácora es append-only, y se hace cumplir en la base y no por convención:
 * un registro de auditoría que la aplicación puede reescribir no sirve como
 * evidencia. Sin esto, un inquilino nuevo tendría su historia editable.
 *
 * La FUNCIÓN vive en `public` y se comparte entre inquilinos —es lógica, no
 * datos—; el TRIGGER se crea en cada esquema sobre su propia tabla. */
CREATE OR REPLACE FUNCTION "public"."domain_events_append_only"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'domain_events es append-only: % no está permitido', TG_OP;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "domain_events_no_update_delete" ON "domain_events";--> statement-breakpoint

CREATE TRIGGER "domain_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "domain_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."domain_events_append_only"();
