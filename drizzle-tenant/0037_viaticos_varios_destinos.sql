-- UN VIAJE, VARIOS DESTINOS. Y QUIÉN PUEDE PEDIR CADA UNO, LO DECIDE LA EMPRESA.
--
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md y el comentario de
-- `drizzle.tenant.config.ts`.
--
-- ---------------------------------------------------------------------------
-- QUÉ CAMBIA
--
-- Hasta aquí un viático era de UN contrato o de UN prospecto (0028), y la base
-- lo exigía con `viaticos_asunto_ck`. Eso dejaba fuera dos viajes que el equipo
-- hace de verdad:
--
--   · la VISITA a un cliente que no tiene contrato vigente. No es prospecto —ya
--     compró—, y no hay contrato al que cargarle el gasto. Hoy no aparecía en
--     ninguna de las dos listas del formulario;
--   · la GIRA: un mismo viaje que pasa por dos clientes y un prospecto. Había
--     que pedir tres viáticos para un solo vuelo, o meterlo entero en uno y
--     falsear el costo de los otros dos.
--
-- Así que el destino deja la cabecera y pasa a su propia tabla, uno a muchos.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HAY COLUMNA `tipo` SI LA LLAVE YA DICE CUÁL ES
--
-- La 0028 se negó a tener una columna `tipo` —«la llave que esté puesta ES el
-- tipo»— y tenía razón entonces: contrato y prospecto usaban llaves distintas.
-- Visita y prospecto usan LA MISMA (`organization_id`), y lo que las distingue
-- es si la empresa ya compró, que cambia con el tiempo: el prospecto de hoy es
-- el cliente de mañana. El tipo guardado es lo que la POLÍTICA autorizó el día
-- que se pidió el viaje, y eso no se puede recalcular después. El CHECK ata el
-- tipo a sus llaves para que no puedan contradecirse.
--
-- ---------------------------------------------------------------------------
-- A QUIÉN SE LE CARGA CADA GASTO
--
-- A un DESTINO del viaje (`destino_id`), y dentro de él, si aplica, a un ticket
-- (destino de contrato) o a un negocio (visita o prospecto). Nulo es «gasto
-- general del viaje» —el hotel que sirvió para los tres—, y solo cabe en un
-- viaje de varios destinos: con uno solo, el general ES de ese destino, y lo
-- asigna el dominio. Por eso los gastos que ya existen se pasan TODOS a su
-- único destino, incluidos los «comerciales sueltos» de la 0028: el costo de
-- cada contrato y de cada prospecto sale idéntico antes y después.
--
-- Que un viático tenga al menos un destino no lo puede exigir un CHECK —es otra
-- tabla—. Lo exige `lib/domain/viaticos.ts`, por donde pasa toda alta.
--
-- ---------------------------------------------------------------------------
-- LA POLÍTICA, EN `settings`, Y DE FÁBRICA TODO QUEDA COMO ESTABA
--
--   viaticos_contratos_roles   quién pide viajes a contratos. De fábrica, todos
--                              los roles internos: es lo que pasaba hasta hoy.
--   viaticos_visitas_roles     quién visita clientes sin contrato. Vacío = nadie.
--   viaticos_prospectos_roles  (0033) quién viaja a prospectos. No cambia.
--   viaticos_max_contratos     cuántos contratos caben en una solicitud,
--   viaticos_max_visitas       cuántos clientes a visitar
--   viaticos_max_prospectos    y cuántos prospectos. Uno por tipo y no uno para
--                              todo: una empresa puede querer giras de tres
--                              prospectos y un solo contrato por viaje. 1 = hoy.
--   viaticos_mezclar_destinos  si una misma solicitud junta contratos con
--                              visitas o prospectos. Apagado: el viaje de
--                              servicio y el comercial se piden por separado.
--
-- Encender algo es una decisión de cada empresa, en Configuración → Viáticos.
-- Ver `.claude/skills/decisiones-configurables`.

CREATE TYPE "viatico_destino_tipo" AS ENUM ('contrato', 'visita', 'prospecto');--> statement-breakpoint

CREATE TABLE "viatico_destinos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viatico_id" uuid NOT NULL,
	"tipo" "viatico_destino_tipo" NOT NULL,
	"contract_id" uuid,
	"organization_id" uuid,
	"deal_id" uuid,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viatico_destinos_llave_ck" CHECK (
		("tipo" = 'contrato' AND "contract_id" IS NOT NULL AND "organization_id" IS NULL AND "deal_id" IS NULL)
		OR ("tipo" <> 'contrato' AND "organization_id" IS NOT NULL AND "contract_id" IS NULL)
	)
);--> statement-breakpoint

-- `cascade` desde el viático: un destino no existe fuera de su viaje.
ALTER TABLE "viatico_destinos" ADD CONSTRAINT "viatico_destinos_viatico_id_fk" FOREIGN KEY ("viatico_id") REFERENCES "viaticos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- `restrict` sobre contrato y organización, como en la 0028: borrar la ficha de
-- alguien a quien se le viajó dejaría gastos sin destinatario.
ALTER TABLE "viatico_destinos" ADD CONSTRAINT "viatico_destinos_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viatico_destinos" ADD CONSTRAINT "viatico_destinos_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- `set null` sobre el negocio: es una etiqueta de gestión, el viaje sigue siendo
-- a esa empresa.
ALTER TABLE "viatico_destinos" ADD CONSTRAINT "viatico_destinos_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- El mismo contrato o la misma empresa dos veces en un viaje no es una gira, es
-- un renglón repetido: los gastos no sabrían a cuál de los dos ir.
CREATE UNIQUE INDEX "viatico_destinos_contrato_unico_idx" ON "viatico_destinos" ("viatico_id", "contract_id") WHERE "contract_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "viatico_destinos_organizacion_unico_idx" ON "viatico_destinos" ("viatico_id", "organization_id") WHERE "organization_id" IS NOT NULL;--> statement-breakpoint

-- Los destinos de un viaje, en orden: lo lee cada pantalla del viático.
CREATE INDEX "viatico_destinos_viatico_idx" ON "viatico_destinos" ("viatico_id", "position");--> statement-breakpoint

-- Reemplazan a `viaticos_contrato_idx` y `viaticos_organizacion_idx`: el costo de
-- viaje de un contrato y de una empresa se pregunta ahora por aquí.
CREATE INDEX "viatico_destinos_contrato_idx" ON "viatico_destinos" ("contract_id") WHERE "contract_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "viatico_destinos_organizacion_idx" ON "viatico_destinos" ("organization_id") WHERE "organization_id" IS NOT NULL;--> statement-breakpoint

/*
  LOS VIÁTICOS QUE YA EXISTEN, CADA UNO CON SU ÚNICO DESTINO.

  Todo lo anterior era contrato o prospecto —no existían las visitas—, y el
  CHECK de la 0028 garantizaba que tuviera exactamente uno de los dos.
*/
INSERT INTO "viatico_destinos" ("viatico_id", "tipo", "contract_id", "organization_id", "deal_id", "position", "created_at")
SELECT "id",
       (CASE WHEN "contract_id" IS NOT NULL THEN 'contrato' ELSE 'prospecto' END)::"viatico_destino_tipo",
       "contract_id",
       "organization_id",
       CASE WHEN "contract_id" IS NOT NULL THEN NULL ELSE "deal_id" END,
       0,
       "created_at"
  FROM "viaticos";--> statement-breakpoint

/* ═══════════════ El gasto cuelga de un destino ═══════════════ */

ALTER TABLE "viatico_expenses" ADD COLUMN "destino_id" uuid;--> statement-breakpoint

-- `restrict`: un destino con gastos no se quita del viaje sin decidir antes a
-- dónde van esos gastos.
ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_destino_id_fk" FOREIGN KEY ("destino_id") REFERENCES "viatico_destinos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

UPDATE "viatico_expenses" g
   SET "destino_id" = d."id"
  FROM "viatico_destinos" d
 WHERE d."viatico_id" = g."viatico_id";--> statement-breakpoint

-- Un ticket o un negocio siempre están DENTRO de un destino. Solo el gasto
-- general del viaje va sin destino, y ése no lleva ni ticket ni negocio.
ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_en_destino_ck" CHECK ("destino_id" IS NOT NULL OR ("ticket_id" IS NULL AND "deal_id" IS NULL));--> statement-breakpoint

CREATE INDEX "viatico_expenses_destino_idx" ON "viatico_expenses" ("destino_id") WHERE "destino_id" IS NOT NULL;--> statement-breakpoint

/* ═══════════════ La cabecera deja de guardar el destino ═══════════════ */

/*
  Se QUITAN, no se dejan de leer. Dos lugares que contestan «a dónde fue este
  viaje» acaban contradiciéndose, y la 0033 ya quitó un booleano por lo mismo.
  Sus CHECK e índices se van con ellas; se nombran para que se lea qué se va.
*/
ALTER TABLE "viaticos" DROP CONSTRAINT IF EXISTS "viaticos_asunto_ck";--> statement-breakpoint

ALTER TABLE "viaticos" DROP CONSTRAINT IF EXISTS "viaticos_negocio_ck";--> statement-breakpoint

DROP INDEX IF EXISTS "viaticos_contrato_idx";--> statement-breakpoint

DROP INDEX IF EXISTS "viaticos_organizacion_idx";--> statement-breakpoint

ALTER TABLE "viaticos" DROP COLUMN "contract_id";--> statement-breakpoint

ALTER TABLE "viaticos" DROP COLUMN "organization_id";--> statement-breakpoint

ALTER TABLE "viaticos" DROP COLUMN "deal_id";--> statement-breakpoint

/* ═══════════════ La política de la empresa ═══════════════ */

ALTER TABLE "settings" ADD COLUMN "viaticos_contratos_roles" jsonb DEFAULT '["owner","admin","agent","sales","general"]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "viaticos_visitas_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "viaticos_max_contratos" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "viaticos_max_visitas" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "viaticos_max_prospectos" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "viaticos_mezclar_destinos" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Veinte es un techo de cordura, no de política: una gira de más de veinte
-- paradas de un tipo es un error de captura. El mínimo es 1 y no 0: apagar un
-- tipo es vaciar su lista de roles, y un 0 aquí sería una segunda manera de
-- decir lo mismo, que tarde o temprano contradiría a la primera.
ALTER TABLE "settings" ADD CONSTRAINT "settings_viaticos_max_por_tipo_ck" CHECK (
	"viaticos_max_contratos" BETWEEN 1 AND 20
	AND "viaticos_max_visitas" BETWEEN 1 AND 20
	AND "viaticos_max_prospectos" BETWEEN 1 AND 20
);
