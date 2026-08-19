-- Lo ganado, por fecha de cierre: el índice que sostiene los objetivos.
--
-- El avance de un objetivo comercial es «cuánto se ganó entre estas dos fechas,
-- opcionalmente de este vendedor o este embudo». Se preguntaba una vez por
-- objetivo —doscientas consultas para doscientos objetivos— y ahora se pregunta
-- de una vez con un `left join lateral`; ver `getGoalsWithProgress`.
--
-- Juntar las doscientas en una sola dejó el trabajo del lado de la base, y ahí
-- faltaba el índice: el planificador entraba por `(pipeline_id, closed_at)` y
-- descartaba por estado DESPUÉS de leer, tirando 60 de cada 65 filas.
--
-- Parcial y no `(status, closed_at)`: los ganados son una fracción pequeña de
-- la tabla, así que el índice se mantiene chico, y no se toca al mover negocios
-- entre etapas —la escritura más frecuente del CRM—, solo al cerrarlos.
--
-- Medido sobre la base de desarrollo, 200 objetivos y 2 618 negocios:
-- 27,6 ms → 1,6 ms.
CREATE INDEX IF NOT EXISTS "crm_deals_won_closed_idx"
  ON "crm_deals" ("closed_at")
  WHERE "status" = 'won';
