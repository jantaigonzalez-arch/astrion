-- LAS LLAVES FORÁNEAS QUE NADIE HABÍA INDEXADO.
--
-- Postgres NO crea un índice al declarar una llave foránea, y sin él cada
-- borrado o actualización del padre recorre la tabla hija ENTERA para validar
-- la restricción. No se nota mientras la tabla es pequeña, y para cuando se
-- nota lleva años ahí.
--
-- ---------------------------------------------------------------------------
-- MEDIDO
--
-- Contra `evoelution_ci`, que `pruebas:base` siembra con diez años de historia:
-- 14 151 tickets y 19 073 comentarios.
--
--   borrar UN módulo de equipo, sin estos índices     25,6 ms
--   borrar UN módulo de equipo, con ellos              3,8 ms
--
-- 6,7×, y el borrado en sí no era el coste: lo era validar cuatro llaves a
-- pulso sobre las dos tablas más grandes del esquema. La operación la hace una
-- persona desde la ficha de equipos y espera mirando.
--
-- ---------------------------------------------------------------------------
-- CUATRO Y NO TREINTA
--
-- La consulta que las encuentra devolvía trece candidatas en tablas de más de
-- quinientas filas, y treinta en total. No se indexan todas, y esa es la parte
-- que importa: un índice se paga en cada INSERT y en cada UPDATE de la tabla, y
-- la 0027 existe justamente porque alguien creó uno que ninguna consulta usaba.
--
-- Estas cuatro cumplen las dos condiciones a la vez: están en las tablas
-- grandes Y su padre se borra desde la aplicación —los equipos y sus módulos se
-- dan de baja en la ficha del laboratorio—.
--
-- Se quedan FUERA, a propósito:
--
--   · `tickets.company_id`, `tickets.reviewed_by_id`, `*.created_by_id`,
--     `supplier_payments.actor_id` — apuntan a `users` y a `companies`, que no
--     se borran en la práctica; su padre solo crece;
--   · `contracts.company_id` y `contracts.sales_rep_id` — 624 filas, un seq
--     scan que no llega al milisegundo;
--   · las de `crm_*` — la siembra no genera negocios, así que aquí no hay
--     medición que las respalde. Cuando la haya, se vuelve a medir. Indexar «por
--     si acaso» es exactamente lo que la 0027 vino a deshacer.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md — vale para las dos carpetas.

CREATE INDEX "tickets_modulo_idx" ON "tickets" ("module_id");--> statement-breakpoint

CREATE INDEX "ticket_comments_modulo_idx" ON "ticket_comments" ("module_id");--> statement-breakpoint

CREATE INDEX "ticket_comments_submodulo_idx" ON "ticket_comments" ("submodule_id");--> statement-breakpoint

CREATE INDEX "ticket_comments_equipo_idx" ON "ticket_comments" ("equipment_id");
