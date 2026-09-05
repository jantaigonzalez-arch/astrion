-- VIÁTICOS: LO QUE CUESTA LLEGAR HASTA EL EQUIPO.
--
-- La utilidad de un contrato se calcula hoy como el monto pactado menos lo que
-- costó atenderlo, y ese costo son refacciones y mano de obra. Falta el viaje:
-- el vuelo a Monterrey, tres noches de hotel y las comidas del ingeniero no
-- aparecían en ninguna parte, así que un contrato foráneo se veía tan rentable
-- como uno de la misma ciudad. Este módulo cierra ese hueco, y para eso el
-- gasto tiene que quedar atado a un contrato y a un ticket.
--
-- ---------------------------------------------------------------------------
-- UN DOCUMENTO, DOS ETAPAS, DOS FIRMAS
--
-- El ingeniero pide, General autoriza un monto y responde; el ingeniero
-- comprueba con sus tickets de compra, General da el visto bueno y se cierra.
--
-- Las dos firmas se guardan por separado —`approved_by_id` y `closed_by_id`—
-- aunque casi siempre sean la misma persona: son dos decisiones con semanas de
-- por medio, y colapsarlas haría imposible responder meses después quién dejó
-- pasar una comprobación floja.
--
-- Ninguna de las dos puede ser el solicitante. Eso lo hace cumplir
-- `lib/domain/viaticos.ts` y no la base, porque depende de qué permisos tiene
-- quien firma — un dato que vive en el plano de control, en otro esquema.
--
-- No se parte en dos documentos, como sí se partieron la requisición y la orden
-- de compra. Allá eran dos porque las firman personas distintas y responden
-- preguntas distintas —qué hace falta, a quién comprárselo—. Aquí las dos
-- etapas las vive la MISMA pareja, y partirlo obligaría a mantener un enlace
-- uno-a-uno que nunca se recorre al revés y a contestar «¿cuánto se autorizó?»
-- con un join.
--
-- ---------------------------------------------------------------------------
-- EL TICKET VA EN EL RENGLÓN, NO EN LA CABECERA
--
-- Un viaje que atiende tres equipos genera tres tickets, y el hotel de esa
-- noche es de los tres. Con el ticket en la cabecera habría que cargárselo
-- entero a uno o inventar una regla de reparto que nadie podría defender
-- después. En el renglón, el ingeniero reparte al capturar —el único momento en
-- que alguien sabe de verdad a qué servicio pertenece cada comida— y el costo
-- entra en la utilidad POR TICKET, igual que una refacción consumida.
--
-- ---------------------------------------------------------------------------
-- LOS ESTADOS
--
--   borrador → enviado → autorizado → en_revision → cerrado
--                  ↓          ↑             ↓
--              rechazado      └─────────────┘   (devuelto: falta comprobante)
--
-- `autorizado` es también «comprobando»: no hay estado aparte para el ingeniero
-- cargando gastos porque el conteo de gastos ya lo dice, y un estado que nadie
-- puede distinguir del anterior es un estado que se pone mal. Devolver una
-- comprobación la regresa a `autorizado`, que es donde estaba; el motivo vive
-- en `resolution_reason`.
--
-- ---------------------------------------------------------------------------
-- LAS CATEGORÍAS SON CERRADAS
--
-- Con `otros` como válvula, y `other_label` obligatorio por CHECK cuando se
-- usa. Texto libre produce «Hotel», «hotel» y «HOSPEDAJE SLP» en el mismo
-- trimestre, y a partir de ahí no hay forma de sumar en qué se va el dinero de
-- los viajes.
--
-- `refacciones` es la pieza comprada en ruta porque no podía esperar a una
-- orden de compra: no entra al inventario —nunca estuvo en el almacén— pero sí
-- es costo del servicio, y sin categoría propia acababa en `otros` y
-- desaparecía del análisis.
--
-- ---------------------------------------------------------------------------
-- LA CAMPANA APRENDE A HABLAR DE OTRA COSA
--
-- `notifications` nació con `ticket_id NOT NULL` y su propio comentario decía:
-- «hoy los cinco avisos son de tickets; el día que haya de otra cosa, ampliar
-- esto es una migración, y que se note es preferible a un `subject_id` suelto
-- que admita filas colgando de nada».
--
-- Ese día es hoy, y se amplía como estaba previsto: una columna MÁS. Las dos
-- llaves quedan nulables y un CHECK exige que vaya EXACTAMENTE UNA, que es lo
-- que conserva la propiedad que aquel diseño defendía. Sin el CHECK, un aviso
-- sin asunto se guardaría en silencio y saldría en la campana como un renglón
-- que no lleva a ningún lado.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO
--
-- Como todas las de inquilino: `drizzle-kit generate` con esa configuración
-- produce una migración rota. Ver `drizzle.tenant.config.ts` y la regla 4 de
-- AGENTS.md.

CREATE TYPE "viatico_status" AS ENUM ('borrador', 'enviado', 'autorizado', 'rechazado', 'en_revision', 'cerrado', 'cancelado');--> statement-breakpoint

CREATE TYPE "viatico_categoria" AS ENUM ('hotel', 'transporte', 'comida', 'refacciones', 'otros');--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS "viatico_reference_seq" START WITH 1 INCREMENT BY 1;--> statement-breakpoint

CREATE TABLE "viaticos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(30) NOT NULL UNIQUE,
	"contract_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"destination" varchar(200) NOT NULL,
	"purpose" text NOT NULL,
	"departs_on" date NOT NULL,
	"returns_on" date NOT NULL,
	"estimated_mxn" numeric(12,2) NOT NULL,
	"status" "viatico_status" DEFAULT 'borrador' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"authorized_mxn" numeric(12,2),
	"approval_note" text,
	"reported_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"closing_note" text,
	"resolution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viaticos_fechas_ck" CHECK ("returns_on" >= "departs_on"),
	CONSTRAINT "viaticos_estimado_ck" CHECK ("estimated_mxn" > 0),
	CONSTRAINT "viaticos_autorizado_ck" CHECK ("authorized_mxn" IS NULL OR "authorized_mxn" > 0)
);--> statement-breakpoint

ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "viaticos_status_idx" ON "viaticos" ("status", "departs_on");--> statement-breakpoint

CREATE INDEX "viaticos_solicitante_idx" ON "viaticos" ("requested_by_id", "created_at");--> statement-breakpoint

CREATE INDEX "viaticos_contrato_idx" ON "viaticos" ("contract_id");--> statement-breakpoint

CREATE TABLE "viatico_modules" (
	"viatico_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	CONSTRAINT "viatico_modules_pk" PRIMARY KEY ("viatico_id", "module_id")
);--> statement-breakpoint

ALTER TABLE "viatico_modules" ADD CONSTRAINT "viatico_modules_viatico_id_fk" FOREIGN KEY ("viatico_id") REFERENCES "viaticos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viatico_modules" ADD CONSTRAINT "viatico_modules_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "equipment_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "viatico_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viatico_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"category" "viatico_categoria" NOT NULL,
	"other_label" varchar(120),
	"description" varchar(300) NOT NULL,
	"amount_mxn" numeric(12,2) NOT NULL,
	"spent_on" date NOT NULL,
	"receipt_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viatico_expenses_otros_ck" CHECK ("category" <> 'otros' OR ("other_label" IS NOT NULL AND length(btrim("other_label")) > 0)),
	CONSTRAINT "viatico_expenses_importe_ck" CHECK ("amount_mxn" > 0)
);--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_viatico_id_fk" FOREIGN KEY ("viatico_id") REFERENCES "viaticos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "viatico_expenses_viatico_idx" ON "viatico_expenses" ("viatico_id", "spent_on");--> statement-breakpoint

CREATE INDEX "viatico_expenses_ticket_idx" ON "viatico_expenses" ("ticket_id");--> statement-breakpoint

ALTER TABLE "notifications" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "notifications" ADD COLUMN "viatico_id" uuid;--> statement-breakpoint

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_viatico_id_fk" FOREIGN KEY ("viatico_id") REFERENCES "viaticos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_asunto_ck" CHECK (("ticket_id" IS NOT NULL)::int + ("viatico_id" IS NOT NULL)::int = 1);
