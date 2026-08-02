/* ================================================================
 * Pasos de datos: Evoelution pasa a ser el primer inquilino.
 * Escritos a mano; drizzle-kit no puede inferirlos.
 * ================================================================ */

/* 1. El inquilino. `poc` porque Evoelution es y sigue siendo la prueba de
 *    concepto: el plan real se define cuando exista facturación del SaaS.
 *    ml_contribution queda en false — el consentimiento se otorga desde la UI,
 *    con responsable y fecha, no por una migración. */
INSERT INTO "tenants" ("slug", "name", "status", "plan")
SELECT 'evoelution', 'Evoelution', 'active', 'poc'
 WHERE NOT EXISTS (SELECT 1 FROM "tenants" WHERE "slug" = 'evoelution');
--> statement-breakpoint
/* 2. Las empresas existentes quedan bajo ese inquilino. */
UPDATE "companies"
   SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution')
 WHERE "tenant_id" IS NULL;
--> statement-breakpoint
-- El rol global de cada usuario se convierte en una membresía.
-- admin → owner: en un mundo de un solo inquilino el administrador ERA el dueño,
-- y `owner` es quien puede otorgar el consentimiento de datos para modelos
-- globales. Esa facultad no debería quedar en cualquier admin.
--
-- Una sentencia por rol, y con u."role"::text en el predicado, en vez de un
-- CASE que devuelva el enum: los tipos membership_role y user_role se crean en
-- esta misma corrida de migraciones, y el driver resuelve los OID de tipo al
-- conectarse — no conoce los nacidos después. Comparar como texto evita
-- depender de esa resolución.

INSERT INTO "memberships" ("user_id", "tenant_id", "role", "active", "accepted_at")
SELECT u."id",
       (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution'),
       'owner',
       u."active",
       now()
  FROM "users" u
 WHERE u."role"::text = 'admin'
   AND NOT EXISTS (
     SELECT 1 FROM "memberships" m
      WHERE m."user_id" = u."id"
        AND m."tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution')
   );
--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "tenant_id", "role", "active", "accepted_at")
SELECT u."id",
       (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution'),
       'agent',
       u."active",
       now()
  FROM "users" u
 WHERE u."role"::text = 'agent'
   AND NOT EXISTS (
     SELECT 1 FROM "memberships" m
      WHERE m."user_id" = u."id"
        AND m."tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution')
   );
--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "tenant_id", "role", "active", "accepted_at")
SELECT u."id",
       (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution'),
       'sales',
       u."active",
       now()
  FROM "users" u
 WHERE u."role"::text = 'sales'
   AND NOT EXISTS (
     SELECT 1 FROM "memberships" m
      WHERE m."user_id" = u."id"
        AND m."tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution')
   );
--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "tenant_id", "role", "active", "accepted_at")
SELECT u."id",
       (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution'),
       'client',
       u."active",
       now()
  FROM "users" u
 WHERE u."role"::text = 'client'
   AND NOT EXISTS (
     SELECT 1 FROM "memberships" m
      WHERE m."user_id" = u."id"
        AND m."tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'evoelution')
   );
--> statement-breakpoint
/* 4. Alta del inquilino en la bitácora de la plataforma. Es el primer registro
 *    de una tabla que debe sobrevivir incluso a la baja de un inquilino. */
INSERT INTO "platform_events" ("tenant_id", "event_type", "payload")
SELECT t."id", 'tenant.created',
       jsonb_build_object(
         'slug', t."slug",
         'origen', 'migracion 0015: Evoelution pasa de monolito a inquilino 1',
         'usuarios_migrados', (SELECT count(*) FROM "users"),
         'empresas_adoptadas', (SELECT count(*) FROM "companies" WHERE "tenant_id" = t."id")
       )
  FROM "tenants" t
 WHERE t."slug" = 'evoelution'
   AND NOT EXISTS (
     SELECT 1 FROM "platform_events" p
      WHERE p."tenant_id" = t."id" AND p."event_type" = 'tenant.created'
   );