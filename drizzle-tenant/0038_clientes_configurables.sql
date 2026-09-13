-- LO QUE DECIDE CADA EMPRESA SOBRE SUS CLIENTES.
--
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md y el comentario de
-- `drizzle.tenant.config.ts`. Y ver `.claude/skills/decisiones-configurables`:
-- cada columna es una decisión de negocio que estaba fija en el código, y de
-- fábrica todas dejan las cosas exactamente como estaban.
--
--   clientes_sla_horas         el plazo de primera respuesta de un cliente que
--                              no pactó el suyo. Era la constante `SLA_HOURS`
--                              (2 h), y su propio comentario decía que el día
--                              que dos empresas prometieran distinto, su sitio
--                              era `settings`. En un SaaS ese día ya llegó.
--   clientes_uso_cfdi_omision  con qué uso de CFDI nace el expediente de un
--                              cliente nuevo. Nulo = sin sugerencia, como hoy.
--                              No es la regla fiscal —esa la sigue haciendo
--                              cumplir `domain/cliente.ts` contra el régimen de
--                              cada cliente—: es el valor con el que abre el
--                              formulario.
--   clientes_pruebas           qué cuenta como prueba de que una organización
--                              es cliente: `portal` (cuenta enlazada),
--                              `pedido` (negocio ganado), `contrato` (firmado
--                              desde un negocio). Las tres, como hasta hoy.
--                              Decide quién sale en Clientes o en Ventas y a
--                              quién se visita o se prospecta en viáticos:
--                              lo lee `ES_CLIENTE` dentro de la misma consulta.
--   clientes_69b_presunto      qué hacer con un cliente en la lista 69-B del
--   clientes_69b_definitivo    SAT: `nada`, `avisar` o `bloquear` (contratos
--                              nuevos y tickets). `nada`, como hoy.
--
-- Texto con CHECK y no un enum para la política 69-B: son tres palabras que
-- solo lee esta fila, y un `CREATE TYPE` en una migración de inquilino es la
-- trampa descrita en el skill `modelo-de-datos` §9.

ALTER TABLE "settings" ADD COLUMN "clientes_sla_horas" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint

-- El mismo rango que `slaHorasValidas`: de una hora a treinta días. Cero no:
-- un SLA de cero horas nace vencido, que es apagar el compromiso en silencio.
ALTER TABLE "settings" ADD CONSTRAINT "settings_clientes_sla_horas_ck" CHECK ("clientes_sla_horas" BETWEEN 1 AND 720);--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "clientes_uso_cfdi_omision" varchar(5);--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "clientes_pruebas" jsonb DEFAULT '["portal","pedido","contrato"]'::jsonb NOT NULL;--> statement-breakpoint

-- Al menos una prueba: sin ninguna, nadie sería cliente y todo el padrón
-- pasaría a Ventas como prospecto. Si una empresa lo quisiera de verdad, que lo
-- diga quitando las pruebas una a una, no por una lista vacía escrita a mano.
ALTER TABLE "settings" ADD CONSTRAINT "settings_clientes_pruebas_ck" CHECK (
	jsonb_typeof("clientes_pruebas") = 'array'
	AND jsonb_array_length("clientes_pruebas") >= 1
	AND "clientes_pruebas" <@ '["portal","pedido","contrato"]'::jsonb
);--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "clientes_69b_presunto" varchar(10) DEFAULT 'nada' NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "clientes_69b_definitivo" varchar(10) DEFAULT 'nada' NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" ADD CONSTRAINT "settings_clientes_69b_ck" CHECK (
	"clientes_69b_presunto" IN ('nada', 'avisar', 'bloquear')
	AND "clientes_69b_definitivo" IN ('nada', 'avisar', 'bloquear')
);
