-- El índice único de `ml_forecasts`, que no servía para lo único que hacía falta.
--
-- La 0013 lo creó como índice de EXPRESIÓN:
--
--   unique (model_id, period, coalesce(subject_key, ''))
--
-- y el código que lo necesita hace `on conflict (model_id, period, subject_key)`.
-- Postgres exige que la inferencia del ON CONFLICT coincida EXACTAMENTE con la
-- definición del índice, y `coalesce(subject_key,'')` no es `subject_key`: la
-- inserción falla con «there is no unique or exclusion constraint matching the
-- ON CONFLICT specification». El índice existía, era correcto, y era inservible.
--
-- Es un fallo que no se ve leyendo ninguno de los dos lados por separado —el
-- índice está bien escrito, el ON CONFLICT también— y solo aparece al
-- ejecutarlos juntos: al pulsar «Poner a servir».
--
-- ── POR QUÉ HABÍA UN COALESCE ──────────────────────────────────────────────
--
-- Por el comportamiento normal de UNIQUE con nulos: en un índice único, dos
-- filas con `subject_key IS NULL` NO chocan, porque en SQL un nulo no es igual a
-- otro nulo. Y `subject_key` es nulo justo en el caso más común —una serie del
-- negocio entero, sin entidad—, así que sin el coalesce cada reemisión del
-- pronóstico habría duplicado las seis filas en vez de actualizarlas.
--
-- ── LA SALIDA ──────────────────────────────────────────────────────────────
--
-- `NULLS NOT DISTINCT` dice justamente eso: para este índice, dos nulos son el
-- mismo valor. Resuelve el problema original sin una expresión de por medio, así
-- que el ON CONFLICT puede inferirlo.
--
-- La alternativa era volver `subject_key` NOT NULL DEFAULT ''. Se descarta a
-- conciencia: obligaría a que «esta serie no es de ninguna entidad» se escriba
-- como cadena vacía, y una cadena vacía que significa «ninguno» es de las cosas
-- que dentro de un año alguien confunde con «entidad sin nombre».
--
-- Exige Postgres 15 o superior. El compose fija postgres:16-alpine.

DROP INDEX IF EXISTS "ml_forecasts_uq";

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ml_forecasts_uq"
  ON "ml_forecasts" ("model_id", "period", "subject_key")
  NULLS NOT DISTINCT;
