-- Se van los siete tableros de fábrica que nadie llegó a tocar.
--
-- ── QUÉ PASÓ ──────────────────────────────────────────────────────────────
--
-- La migración 0018 los materializó: hasta entonces «el tablero del módulo X»
-- era un objeto que se inventaba al vuelo, y al soltar el tablero del módulo
-- hacía falta una fila donde guardar su nombre. Se sembraron los siete.
--
-- El efecto no se vio hasta tenerlos delante: el menú lateral pasó a listar
-- siete renglones llamados todos «Dashboard de…», truncados al mismo prefijo y
-- todos en borrador. Ruido puro, y encima permanente — cada empresa nueva los
-- heredaba.
--
-- Salían porque un tablero de fábrica hereda del catálogo los análisis con
-- `defaultOn` en su pantalla, así que tenía bloques y el menú lo consideraba
-- digno de listarse. La regla del menú está bien; lo que estaba mal es que
-- existieran siete tableros que nadie pidió.
--
-- ── POR QUÉ NO SE PIERDE NADA ─────────────────────────────────────────────
--
-- Los análisis no vivían en estas filas: viven en el catálogo. Once de ellos
-- salen además en su pantalla de trabajo y ahí siguen igual. Los otros siete
-- —los cuatro de rentabilidad y los tres de clientes— solo tenían tablero, y
-- se recuperan al crear uno desde el botón de su módulo: `createDashboard`
-- siembra los análisis de fábrica de ese módulo.
--
-- Un tablero existe cuando alguien lo crea. Eso es todo el cambio.
--
-- ── QUÉ SE CONSERVA, Y POR QUÉ EL BORRADO ES CONSERVADOR ──────────────────
--
-- Solo se borra lo INTACTO: sin colocaciones propias y sin publicar. Un
-- tablero de fábrica que alguien compuso —aunque no lo haya renombrado— es
-- trabajo de una persona, y esta migración no puede saber si fue una prueba o
-- el tablero que su equipo usa a diario. Se queda, y se borra desde la
-- pantalla si sobra.
--
-- El `on delete cascade` de `dashboard_modules` se lleva sus filas de módulo.

DELETE FROM "dashboards" d
 WHERE d."slug" IN (
   'servicio','ventas','clientes','refacciones','compras','pagos','rentabilidad'
 )
   -- Nadie lo publicó.
   AND d."published_at" IS NULL
   -- Y nadie colocó, movió ni apagó nada en él: sin filas propias, todo lo que
   -- enseñaba venía del catálogo.
   AND NOT EXISTS (
     SELECT 1 FROM "analysis_placements" p
      WHERE p."screen" = 'dashboard:' || d."slug"
   )
   -- Ni le cambió el nombre. Un tablero rebautizado es una decisión, aunque
   -- esté vacío: alguien pensó para qué lo quería.
   AND d."title" LIKE 'Dashboard de %';
