-- LA PANTALLA DE INICIO RECORRÍA LOS TICKETS ENTEROS EN CADA CARGA.
--
-- ESCRITA A MANO. Regla 4 de AGENTS.md.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE MIDIÓ
--
-- El panel de inicio dibuja una serie de doce meses con los servicios cerrados.
-- Su consulta preguntaba `date_trunc('month', resolved_at) = mes`, que se lee
-- muy bien y esconde la columna del planificador: una función sobre la columna
-- deja fuera cualquier índice. Con `explain analyze` sobre la base sembrada
-- (14 151 tickets):
--
--   como estaba          Seq Scan      28,85 ms
--   por rango, sin índice Seq Scan     19–64 ms
--   por rango + ESTE índice  Index Scan  2,5–3,5 ms
--
-- Diez veces menos, en la pantalla que abre todo el mundo al entrar. La consulta
-- ya se reescribió como rango; esto es la otra mitad.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ PARCIAL, Y POR QUÉ ESTE Y NO OTROS
--
-- El skill de rendimiento avisa de que un índice se paga en cada `INSERT` y de
-- que no hay que indexarlo todo. Éste se justifica y se acota:
--
--   · PARCIAL: solo las filas resueltas o cerradas con fecha. Un ticket abierto
--     no entra, así que el índice es una fracción de la tabla y las altas —que
--     son lo que más se escribe— no lo tocan.
--   · La escritura que sí lo toca es resolver un ticket, que ocurre una vez por
--     ticket y no en bucle.
--   · Y el beneficio está medido en la pantalla más visitada, no supuesto.

CREATE INDEX IF NOT EXISTS "tickets_resueltos_idx"
  ON "tickets" ("resolved_at")
  WHERE "status" in ('resolved','closed') AND "resolved_at" IS NOT NULL;
