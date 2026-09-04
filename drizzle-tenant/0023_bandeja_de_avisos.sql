-- LA BANDEJA DE AVISOS DE CADA PERSONA.
--
-- Hasta aquí el único canal era el correo, y tenía dos problemas de distinto
-- tamaño. El chico: quien trabaja dentro del sistema tiene que salirse a su
-- bandeja de correo para enterarse de algo que pasa en la pantalla que ya tiene
-- abierta. El grande: el correo al equipo se acumula hasta que se filtra, y un
-- agente que recibe un mensaje por cada ticket, cada comentario y cada
-- asignación deja de leerlos en una semana — y a partir de ahí tampoco lee el
-- que sí importaba.
--
-- ---------------------------------------------------------------------------
-- EL REPARTO DE CANALES
--
-- Todo el mundo tiene campana. Solo el CLIENTE recibe además correo, porque no
-- vive aquí: entra cuando tiene un problema y se va, así que para él el correo
-- sigue siendo el canal y la campana es lo que se encuentra si entra. Al equipo
-- se le deja de mandar correo por lo mismo que dice el párrafo de arriba.
--
-- ---------------------------------------------------------------------------
-- UNA FILA POR PERSONA Y POR AVISO
--
-- No una fila por evento con la lista de destinatarios dentro. `read_at` es de
-- CADA persona: con una fila compartida, que uno la marque leída se la marcaría
-- a los siete, que es exactamente lo que una bandeja no puede hacer.
--
-- El costo es multiplicar filas —un ticket nuevo escribe siete— y es un costo
-- que se paga con gusto: son filas diminutas y el índice de no leídos es
-- parcial, así que se mantiene chico para siempre en vez de crecer con todo el
-- histórico ya visto.
--
-- ---------------------------------------------------------------------------
-- LAS DOS LLAVES, Y POR QUÉ UNA VA CALIFICADA Y LA OTRA NO
--
-- `user_id` apunta a `public.users`: las identidades viven una sola vez para
-- toda la plataforma. `ticket_id` apunta al `tickets` de ESTE esquema, sin
-- calificar, y `prepareStatements` se encarga de quitarle el `public.` al
-- aplicarla a cada inquilino. Ver la cabecera de `tenancy/provision.ts`.
--
-- Las dos en cascada: un aviso que apunta a un ticket borrado —o de una cuenta
-- borrada— es un renglón que lleva a una pantalla que no existe.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO
--
-- Como todas las de inquilino: `drizzle-kit generate` con esa configuración
-- produce una migración rota. Ver el comentario de `drizzle.tenant.config.ts` y
-- la regla 4 de AGENTS.md.

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" varchar(400),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- La lista de la campana: lo mío, lo más reciente arriba.
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint

-- El contador del punto rojo. Parcial a propósito: solo se cuenta lo NO leído.
CREATE INDEX "notifications_sin_leer_idx" ON "notifications" USING btree ("user_id") WHERE "read_at" is null;
