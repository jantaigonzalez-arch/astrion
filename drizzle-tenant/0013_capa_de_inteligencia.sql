-- La capa de inteligencia: lo que las tablas del laboratorio no sabían guardar.
--
-- Se EXTIENDEN las tablas existentes en vez de crear unas nuevas, y no por
-- ahorrar trabajo: `ml_predictions` es lo que lee la capa de Análisis para
-- poner un pronóstico en la pantalla donde alguien decide. Con tablas nuevas,
-- esos paneles se quedarían callados para siempre y habría que reescribir
-- `insights.ts` entero para revivirlos.
--
-- Lo que falta y se añade:
--
--   · el MÓDULO. La configuración empieza donde el usuario está —Refacciones,
--     Ventas— y no donde está el modelo. Sin esta columna no hay forma de
--     enseñarle sus preguntas agrupadas por donde trabaja.
--
--   · la TAREA. El laboratorio anterior solo sabía predecir números; ahora hay
--     pronóstico de series, regresión, clasificación y anomalías, y cada una se
--     evalúa distinto. Guardarla es lo que permite que una plantilla de
--     clasificación no se mida con el error absoluto de una de regresión.
--
--   · el HORIZONTE y el GRANO. Un pronóstico a tres meses y otro a uno son dos
--     modelos distintos sobre la misma serie: se entrenan por separado —directo,
--     no recursivo— y hay que poder tener los dos.
--
--   · el TIPO DE MARGEN. ±15 días significa cosas distintas para una lámpara de
--     400 días y un sello de 75. Sin esta columna, el número guardado se
--     reinterpreta solo el día que cambie el criterio del objetivo.
--
--   · la FAMILIA forzada. `null` significa «que elija el AutoML». Que se pueda
--     fijar importa: a veces el negocio necesita un modelo que pueda explicar
--     en una junta, aunque otro acierte un punto más — y hay que dejar escrito
--     que fue elección y no búsqueda.

ALTER TABLE "ml_templates"
  ADD COLUMN IF NOT EXISTS "module" varchar(40) NOT NULL DEFAULT 'servicio',
  ADD COLUMN IF NOT EXISTS "task" varchar(20) NOT NULL DEFAULT 'forecast',
  ADD COLUMN IF NOT EXISTS "horizon" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "grain" varchar(10) NOT NULL DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS "tolerance_kind" varchar(10) NOT NULL DEFAULT 'relative',
  ADD COLUMN IF NOT EXISTS "algorithm" varchar(40);

-- `features` deja de ser obligatorio en la práctica: una serie no tiene señales
-- que elegir —su única señal es ella misma y el calendario— y las construye la
-- etapa de rasgos, no el usuario. Se queda `not null` con default para no
-- romper nada que ya inserte sin ella.
ALTER TABLE "ml_templates"
  ALTER COLUMN "features" SET DEFAULT '[]'::jsonb;

--> statement-breakpoint

-- El modelo entrenado, serializado.
--
-- Columna propia y no dentro de `params`: `params` es jsonb y describe CÓMO se
-- configuró el modelo —algo que se lee y se muestra— mientras esto es un blob
-- opaco de decenas de kilobytes que solo el servicio de Python sabe abrir.
-- Mezclarlos habría hecho ilegible cualquier consulta que quisiera mirar la
-- configuración.
--
-- Y vive AQUÍ, en el esquema de la empresa, no en el servicio de inteligencia.
-- Es lo que sostiene la promesa que el producto ya le hace al cliente: tus
-- modelos viven donde viven tus datos, y un respaldo de tu base se los lleva
-- consigo. El servicio es un motor sin estado que se puede reiniciar o
-- reemplazar sin que ninguna empresa pierda nada.
ALTER TABLE "ml_models"
  ADD COLUMN IF NOT EXISTS "model_blob" text,
  -- El perfilado del conjunto con el que se entrenó: cuántos periodos había,
  -- desde cuándo, y los avisos. Se guarda con el modelo porque explica su
  -- veredicto, y dentro de seis meses el histórico ya no será el mismo.
  ADD COLUMN IF NOT EXISTS "data_profile" jsonb;

--> statement-breakpoint

-- Los pronósticos emitidos, por periodo.
--
-- `ml_predictions` guarda UNA cifra por sujeto y eso no alcanza para una serie:
-- un pronóstico son seis meses con su banda cada uno. Podría haberse metido
-- como seis filas de `ml_predictions`, y no: esa tabla existe para medir la
-- deriva contra un desenlace real por entidad, y llenarla de periodos futuros
-- rompería ese cálculo sin avisar.
CREATE TABLE IF NOT EXISTS "ml_forecasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_id" uuid NOT NULL,
  -- Cuándo se emitió el pronóstico. Sirve para lo único que hace honesta a una
  -- proyección con el tiempo: comparar lo que se dijo en marzo con lo que pasó,
  -- sin que la versión de hoy tape lo que la de marzo prometió.
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- El periodo pronosticado.
  "period" date NOT NULL,
  "value" numeric(16, 2) NOT NULL,
  "lower" numeric(16, 2),
  "upper" numeric(16, 2),
  -- Qué pasó de verdad. Nulo hasta que el periodo cierre.
  "actual" numeric(16, 2),
  "settled_at" timestamp with time zone,
  -- Por entidad, cuando la serie se abre por pieza o por equipo.
  "subject_key" varchar(120)
);

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ml_forecasts"
    ADD CONSTRAINT "ml_forecasts_model_id_ml_models_id_fk"
    FOREIGN KEY ("model_id") REFERENCES "ml_models"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint

-- Un pronóstico por modelo, periodo y entidad. Sin esto, reemitir el mismo
-- pronóstico duplica filas y el gráfico dibuja dos líneas encima de la otra.
CREATE UNIQUE INDEX IF NOT EXISTS "ml_forecasts_uq"
  ON "ml_forecasts" ("model_id", "period", COALESCE("subject_key", ''));

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ml_forecasts_periodo_idx"
  ON "ml_forecasts" ("period");
