-- Quien OPERA Astraion deja de ser una columna de quien la USA.
--
-- `users.platform_role` era nulo en 137 de 138 cuentas, y la única que lo tenía
-- —`admin@evoelution.com`— era además miembro de dos empresas. Una contraseña
-- abría la consola de todos los clientes y el portal de uno. Ahora son dos
-- identidades, con dos credenciales, aunque detrás haya una sola persona.
--
-- ---------------------------------------------------------------------------
-- LOS UUID SE CONSERVAN, Y ES LO QUE HACE ESTA MIGRACIÓN BARATA
--
-- La cuenta nueva nace con el MISMO id que tenía en `users`. Por eso las 52
-- filas de `platform_events.actor_id` siguen siendo válidas cuando su foránea
-- pasa a apuntar a la tabla nueva: no se remapea ni una. Copiar con ids nuevos
-- habría exigido una tabla de correspondencia y un UPDATE por cada columna que
-- registra a un operador — hoy dos, mañana las que salgan.
--
-- Se comprobó antes de escribir esto que los 52 eventos y los 0 revisores de
-- alta son todos del superadministrador. Si en otra instalación hubiera un
-- `actor_id` de alguien SIN rol de plataforma, el paso 3 falla en vez de borrar
-- el rastro en silencio, que es lo que se quiere: ese dato hay que mirarlo.
--
-- LO QUE NO SE BORRA
--
-- La fila en `users` se queda. `admin@evoelution.com` sigue siendo administrador
-- de Evoelution y miembro de sus dos empresas; lo que pierde es el poder de
-- operar la plataforma con esa misma llave. Borrarla habría tirado sus
-- membresías por el `on delete cascade`.
-- ---------------------------------------------------------------------------

-- 1 · La tabla.
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160),
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"role" "platform_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint

-- 2 · Los operadores que ya existían, con su id y su contraseña intactos: nadie
--     se queda fuera de la consola por desplegar esto.
INSERT INTO "platform_users" ("id", "name", "email", "password_hash", "role", "active", "created_at")
SELECT "id", "name", "email", "password_hash", "platform_role", "active", "created_at"
  FROM "users"
 WHERE "platform_role" IS NOT NULL;
--> statement-breakpoint

-- 3 · Las dos columnas que registran a un operador pasan a apuntar donde deben.
--     Si algún actor no era personal de plataforma, esto falla aquí. A propósito.
ALTER TABLE "platform_events" DROP CONSTRAINT "platform_events_actor_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_actor_id_platform_users_id_fk"
	FOREIGN KEY ("actor_id") REFERENCES "public"."platform_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_signups" DROP CONSTRAINT "tenant_signups_reviewed_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "tenant_signups" ADD CONSTRAINT "tenant_signups_reviewed_by_platform_users_id_fk"
	FOREIGN KEY ("reviewed_by") REFERENCES "public"."platform_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 4 · Y la columna vieja se va. Desde aquí, ninguna consulta de la aplicación
--     puede volver a confundir usar el producto con operarlo.
--     El tipo `platform_role` NO se borra: ahora lo usa `platform_users.role`.
ALTER TABLE "users" DROP COLUMN "platform_role";
