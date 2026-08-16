ALTER TABLE "tenants" ADD COLUMN "folio_prefix" varchar(8);--> statement-breakpoint
-- Los inquilinos que YA emitieron folios conservan su serie.
-- Evoelution lleva 602 tickets con prefijo EVO-: cambiarlo partiría en dos la
-- numeración de documentos que el cliente ya tiene en su correo y en reportes
-- de servicio firmados. Un folio emitido no se reescribe.
UPDATE "tenants" SET "folio_prefix" = 'EVO' WHERE "slug" = 'evoelution' AND "folio_prefix" IS NULL;--> statement-breakpoint
-- El resto arranca con un prefijo derivado del identificador. Es una
-- propuesta: la empresa puede cambiarlo desde Configuración → Marca mientras
-- no haya emitido folios.
UPDATE "tenants"
SET "folio_prefix" = coalesce(
  nullif(upper(substring(regexp_replace("slug", '[^a-zA-Z0-9]', '', 'g') from 1 for 3)), ''),
  'ORG'
)
WHERE "folio_prefix" IS NULL;
