-- El tamaño de un bloque deja de ser «media fila o fila entera».
--
-- ── QUÉ HABÍA Y POR QUÉ NO ALCANZA ────────────────────────────────────────
--
-- `width` era `'full' | 'half'` sobre una rejilla de dos columnas: TRES
-- tamaños posibles en total, contando que media fila y fila entera son lo
-- mismo en un tablero de un solo bloque. Y ninguna noción de alto, así que una
-- serie de doce meses y un ranking de tres filas ocupaban lo mismo.
--
-- ── DOS ENTEROS, Y UNA SOLA REPRESENTACIÓN ────────────────────────────────
--
--   w  1..4  columnas que ocupa, sobre una rejilla de cuatro
--   h  1..3  alto del dibujo: normal, alto, muy alto
--
-- `width` se BORRA en vez de conservarse traducido. Dos campos que significan
-- lo mismo divergen en el primer retoque —ya pasó en este repo con las tres
-- paletas de color que se declaraban «la validada»— y aquí sería peor, porque
-- el que quedara sin actualizar decidiría el layout de un tablero publicado.
--
-- La traducción es la obvia y conserva lo que cada quien ya había compuesto:
-- media fila eran dos columnas de cuatro; fila entera, las cuatro.
--
-- ── EL ALTO NO ES `row-span` ──────────────────────────────────────────────
--
-- Es la altura del DIBUJO, y la tarjeta crece con él. Un `row-span` sobre
-- filas de alto fijo habría dejado que un bloque con más contenido del que
-- cabe se derrame sobre el de abajo, y un tablero que se pisa a sí mismo es
-- peor que uno con bloques de tamaño parejo. Ver `ALTO_VIZ` en el compositor.

ALTER TABLE "analysis_placements" ADD COLUMN "w" smallint;--> statement-breakpoint
ALTER TABLE "analysis_placements" ADD COLUMN "h" smallint;--> statement-breakpoint

UPDATE "analysis_placements"
   SET "w" = CASE "width" WHEN 'half' THEN 2 ELSE 4 END,
       "h" = 1;--> statement-breakpoint

-- Después de rellenar, nunca antes: con filas existentes y sin valor, un
-- NOT NULL sin defecto falla al aplicarse.
ALTER TABLE "analysis_placements" ALTER COLUMN "w" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_placements" ALTER COLUMN "h" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_placements" ALTER COLUMN "w" SET DEFAULT 4;--> statement-breakpoint
ALTER TABLE "analysis_placements" ALTER COLUMN "h" SET DEFAULT 1;--> statement-breakpoint

ALTER TABLE "analysis_placements" DROP COLUMN "width";
