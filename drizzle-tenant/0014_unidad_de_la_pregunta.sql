-- La unidad de lo que se pregunta, guardada CON la pregunta.
--
-- Es una desnormalización deliberada: la unidad es propiedad de la serie y vive
-- en el catálogo del servicio de inteligencia, así que guardarla aquí la duplica.
--
-- Se hace porque una pantalla de operación tiene que poder dibujar el bloque de
-- pronóstico SIN el servicio delante. La regla de la capa de análisis es que
-- nada se calcula al pintar —se lee lo ya escrito— y pedirle la unidad al
-- servicio para poner «MXN» al lado de una cifra colgaría la cola de tickets de
-- una llamada de red al motor de modelos. Con el motor caído, la pantalla
-- enseñaría el número sin unidad, que es peor que no enseñarlo.
--
-- La copia se toma en el momento de crear la pregunta y no se refresca. Si el
-- catálogo cambiara la unidad de una serie, las preguntas viejas seguirían con
-- la suya — y eso es lo correcto: el modelo se entrenó sobre esa magnitud.

ALTER TABLE "ml_templates"
  ADD COLUMN IF NOT EXISTS "unit" varchar(20) NOT NULL DEFAULT '';
