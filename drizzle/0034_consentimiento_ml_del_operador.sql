-- QUIÉN DIO EL CONSENTIMIENTO DE ML ES UN OPERADOR, NO UN USUARIO DE EMPRESA.
--
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md: `drizzle-kit generate` compara
-- contra un snapshot viejo y produce una migración que rehace todas.
--
-- ---------------------------------------------------------------------------
-- QUÉ PASABA
--
-- `tenants.ml_consent_by` nació (0015) apuntando a `users`, cuando el personal
-- de Astraion todavía vivía ahí. La 0023 los mudó a `platform_users` y esta
-- foránea se quedó atrás: otorgar el aporte a modelos globales —que solo hace
-- un superadministrador, desde la consola— reventaba con cualquier operador
-- creado después de la separación. Lo encontró `_probe-acciones-plataforma`.
--
-- ---------------------------------------------------------------------------
-- LOS DATOS
--
-- Medido en la copia de producción del 2026-09-12: ninguna empresa tiene el
-- consentimiento otorgado, así que no hay fila que mover. Si al ensayarla con
-- `npm run sync:prod` apareciera alguna que no esté en `platform_users`, el
-- ADD CONSTRAINT falla y lo dice: es mejor que borrar en silencio quién dio
-- un consentimiento.

ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_ml_consent_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_ml_consent_by_platform_users_id_fk"
  FOREIGN KEY ("ml_consent_by") REFERENCES "public"."platform_users"("id")
  ON DELETE set null ON UPDATE no action;
