-- Los bloques dejan de fluir y pasan a tener POSICIÓN. Lienzo libre.
--
-- ── QUÉ CAMBIA DE VERDAD ──────────────────────────────────────────────────
--
-- Hasta aquí un tablero era una rejilla con flujo automático: cada bloque decía
-- cuánto ocupaba (`w`, `h`) y el navegador decidía DÓNDE, acomodándolos uno
-- detrás de otro. Ahora cada bloque dice también dónde va, y nadie lo reacomoda.
--
--   x  0..23   columna donde empieza, sobre una retícula de 24
--   y  0..     fila donde empieza, en unidades de 32 px
--   w  1..24   columnas que ocupa
--   h  1..     filas que ocupa
--
-- Se pueden SOLAPAR y se pueden dejar huecos, que es justo lo que un flujo
-- automático no permite y lo que se pidió: poner cada cosa donde uno quiere.
--
-- ── LA RETÍCULA NO ES UNA CONCESIÓN, ES LO QUE LO HACE UTILIZABLE ─────────
--
-- 24 columnas fluidas de ancho y filas de 32 px de alto. Es lo que usan los
-- constructores de tableros web serios, y no píxeles absolutos, por dos
-- motivos: un bloque de 437 px de ancho no se puede alinear con el de al lado
-- sin pelearse con el ratón, y el ancho en porcentaje deja que el tablero
-- acompañe la ventana sin recalcular nada. El alto sí es fijo, porque el texto
-- también lo es: escalar el alto con el ancho encoge la letra hasta que deja
-- de leerse, que es exactamente lo que le pasa a un lienzo de píxeles puros en
-- una pantalla más chica.
--
-- ── DE DÓNDE SALEN LAS POSICIONES DE LO YA COMPUESTO ──────────────────────
--
-- Se REPRODUCE el acomodo que el navegador venía haciendo, para que nadie abra
-- su tablero y lo encuentre desordenado. El CTE recursivo recorre los bloques
-- en su orden y va colocando cada uno a la derecha del anterior, bajando de
-- fila cuando no cabe — que es literalmente lo que hacía el flujo. Recursivo y
-- no una función de ventana porque colocar el bloque N exige saber dónde
-- terminó el N-1, y eso una ventana no lo puede encadenar.
--
-- `position` SE QUEDA. Ya no decide el layout, pero sigue siendo el orden de
-- lectura: es de donde sale el apilado en pantallas angostas, donde un lienzo
-- no cabe. Un lienzo sin orden de lectura es un tablero que en un teléfono no
-- se puede enseñar, y ese es el precio que este modelo tiene que pagar de
-- alguna manera.

ALTER TABLE "analysis_placements" ADD COLUMN "x" smallint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "analysis_placements" ADD COLUMN "y" smallint NOT NULL DEFAULT 0;--> statement-breakpoint

-- 1 · El acomodo de siempre, reproducido: `x` y en qué fila cae cada bloque.
CREATE TEMP TABLE _pack ON COMMIT DROP AS
WITH RECURSIVE orden AS (
  SELECT id, screen, w * 6 AS w24,
         CASE "h" WHEN 1 THEN 8 WHEN 2 THEN 11 ELSE 14 END AS h32,
         row_number() OVER (PARTITION BY screen ORDER BY position, analysis) AS n
    FROM "analysis_placements"
), pack AS (
  SELECT id, screen, n, w24, h32, 0 AS x, 0 AS fila
    FROM orden WHERE n = 1
  UNION ALL
  SELECT o.id, o.screen, o.n, o.w24, o.h32,
         CASE WHEN p.x + p.w24 + o.w24 > 24 THEN 0 ELSE p.x + p.w24 END,
         CASE WHEN p.x + p.w24 + o.w24 > 24 THEN p.fila + 1 ELSE p.fila END
    FROM pack p JOIN orden o ON o.screen = p.screen AND o.n = p.n + 1
)
SELECT * FROM pack;--> statement-breakpoint

-- 2 · El `y` es la suma de los altos de las filas ANTERIORES. Una fila mide lo
--     que su bloque más alto: es lo que hace que no se pisen al convertirlas.
CREATE TEMP TABLE _pos ON COMMIT DROP AS
WITH altos AS (
  SELECT screen, fila, max(h32) AS alto FROM _pack GROUP BY screen, fila
), acum AS (
  SELECT screen, fila,
         coalesce(sum(alto) OVER (PARTITION BY screen ORDER BY fila
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS y
    FROM altos
)
SELECT p.id, p.x, a.y, p.w24, p.h32 FROM _pack p
  JOIN acum a ON a.screen = p.screen AND a.fila = p.fila;--> statement-breakpoint

UPDATE "analysis_placements" t
   SET "x" = s.x, "y" = s.y, "w" = s.w24, "h" = s.h32
  FROM _pos s WHERE s.id = t.id;--> statement-breakpoint

-- Los defectos, para lo que nazca de aquí en adelante: media pantalla de ancho
-- y el alto de una gráfica normal.
ALTER TABLE "analysis_placements" ALTER COLUMN "w" SET DEFAULT 12;--> statement-breakpoint
ALTER TABLE "analysis_placements" ALTER COLUMN "h" SET DEFAULT 8;
