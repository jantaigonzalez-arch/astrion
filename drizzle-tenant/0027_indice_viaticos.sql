-- EL ÍNDICE DE VIÁTICOS ESTABA HECHO PARA UN ORDEN QUE NADIE PIDE.
--
-- La migración 0026 creó `viaticos_status_idx (status, departs_on)` pensando en
-- «la bandeja de quien firma, lo que sale antes primero». Después el listado se
-- escribió ordenando por `created_at desc` —lo más reciente arriba, como el
-- resto de los listados del portal— y ninguna consulta llegó a pedir nunca ese
-- orden. Un índice que nadie usa no es neutro: se mantiene en cada INSERT y en
-- cada UPDATE de estado, que en este módulo son la mitad de las escrituras.
--
-- ── MEDIDO ────────────────────────────────────────────────────────────────
--
-- En un esquema de ensayo con 20 000 viajes y 120 000 gastos, con la mezcla de
-- estados que tiene una empresa de verdad —94 % ya cerrados—:
--
--   archivo paginado, con (status, departs_on)          6,34 ms   seq scan
--   archivo paginado, con (status, created_at, id)      0,30 ms   por índice
--
-- Veintiún veces. La diferencia es que el segundo sirve al ORDER BY: Postgres
-- recorre el índice y se detiene al llenar la página, en vez de leer las 18 808
-- filas cerradas y ordenarlas para quedarse con veinticinco.
--
-- La lista de lo ABIERTO ya iba por índice sin esto —es el 5 % de la tabla, así
-- que el filtro por estado la acota sola— y con el índice nuevo sigue igual: es
-- el mismo prefijo `status`.
--
-- ── EL `id` AL FINAL ──────────────────────────────────────────────────────
--
-- Porque el listado desempata por `id`, y sin él en el índice la ordenación
-- quedaría a medias: Postgres tendría que reordenar cada grupo de filas con el
-- mismo `created_at`. Dos viáticos creados en el mismo instante —una carga, una
-- siembra— bastan para que eso ocurra.

DROP INDEX IF EXISTS "viaticos_status_idx";--> statement-breakpoint

CREATE INDEX "viaticos_status_creado_idx" ON "viaticos" ("status", "created_at" DESC, "id" DESC);
