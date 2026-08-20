-- Un tablero deja de ser «el del módulo» y pasa a ser una cosa con nombre.
--
-- ── QUÉ CAMBIA ────────────────────────────────────────────────────────────
--
-- Antes: `UNIQUE (module)`. Exactamente un tablero por módulo, siete como
-- máximo, y el nombre nacía impuesto —«Dashboard de Compras»—. Eso impedía lo
-- que la gente acaba queriendo: tener «Cierre de mes» y «Pendientes de la
-- semana» como dos tableros distintos, o uno que mezcle Ventas con Refacciones.
--
-- Ahora un tablero tiene identidad propia (`slug`) y un nombre que pone quien
-- lo compone, y DÓNDE aparece es una decisión aparte: `dashboard_modules`.
-- Puede publicarse en varios módulos a la vez, en uno, o en ninguno.
--
-- ── POR QUÉ NO HAY MIGRACIÓN DE DATOS ─────────────────────────────────────
--
-- Porque el `slug` de los siete de siempre ES el id de su módulo. Las
-- colocaciones existentes apuntan a `dashboard:ventas` y siguen apuntando ahí;
-- los `defaultOn` del catálogo —que colocan los análisis de fábrica— tampoco se
-- tocan. Lo único que cambia es qué significa esa cadena: antes era «el módulo
-- ventas», ahora es «el tablero que se llama ventas».
--
-- Es lo que hace barato el cambio, y por eso el slug se elige así y no como un
-- uuid.

ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "slug" varchar(60);

--> statement-breakpoint

-- Los que ya existen conservan su identidad: el módulo pasa a ser el slug.
UPDATE "dashboards" SET "slug" = "module" WHERE "slug" IS NULL;

--> statement-breakpoint

/*
  Los siete de fábrica, materializados.

  Hasta aquí la fila solo existía cuando alguien tocaba el tablero, y el resto
  era un objeto virtual que `dashboardStates()` inventaba al vuelo a partir de
  la lista de módulos. Eso funcionaba mientras «tablero» y «módulo» eran la
  misma cosa; en cuanto un tablero puede llamarse como quiera y vivir en varios
  módulos, un tablero sin fila no tiene dónde guardar su nombre.

  Se siembran sin publicar —`published_at` en null— que es exactamente el estado
  que tenían siendo virtuales: compuestos de fábrica y visibles solo para quien
  puede componerlos.

  La lista va escrita a mano porque una migración es una foto de un momento: si
  mañana se agrega un módulo al catálogo, su tablero lo crea la aplicación, no
  este archivo.
*/
INSERT INTO "dashboards" ("module", "slug", "title")
SELECT v.slug, v.slug, v.title
  FROM (VALUES
    ('servicio',     'Dashboard de Servicio'),
    ('ventas',       'Dashboard de Ventas'),
    ('clientes',     'Dashboard de Clientes'),
    ('refacciones',  'Dashboard de Refacciones'),
    ('compras',      'Dashboard de Compras'),
    ('pagos',        'Dashboard de Cuentas por pagar'),
    ('rentabilidad', 'Dashboard de Rentabilidad')
  ) AS v(slug, title)
 WHERE NOT EXISTS (SELECT 1 FROM "dashboards" d WHERE d."slug" = v.slug);

--> statement-breakpoint

ALTER TABLE "dashboards" ALTER COLUMN "slug" SET NOT NULL;

--> statement-breakpoint

-- El slug es la identidad: es lo que va en la URL y en el prefijo de pantalla.
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_slug_uq" ON "dashboards" ("slug");

--> statement-breakpoint

-- Dónde se publica cada tablero. Cero, uno o varios módulos.
--
-- Tabla de relación y no una columna, porque la respuesta honesta a «¿en qué
-- módulo va este tablero?» es «en los que decidas». Un tablero de cierre de mes
-- interesa en Ventas y en Rentabilidad, y obligar a elegir uno solo llevaba a
-- duplicarlo — dos tableros que hay que mantener iguales a mano.
CREATE TABLE IF NOT EXISTS "dashboard_modules" (
  "dashboard_id" uuid NOT NULL REFERENCES "dashboards"("id") ON DELETE CASCADE,
  -- El módulo del ERP: `ventas`, `clientes`, `rentabilidad`…
  "module" varchar(40) NOT NULL,
  -- El orden de los módulos DE ESTE TABLERO: cero es su módulo principal. De
  -- ahí sale la regla del botón flotante — una pantalla abre el tablero que la
  -- tiene como principal— y los demás se llegan por el menú lateral.
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("dashboard_id", "module")
);

--> statement-breakpoint

-- Cada tablero de siempre queda publicado en su propio módulo, que es donde
-- estaba. Nadie tiene que volver a colocarlos.
INSERT INTO "dashboard_modules" ("dashboard_id", "module")
SELECT d."id", d."slug"
  FROM "dashboards" d
 WHERE d."slug" IN ('servicio','ventas','clientes','refacciones','compras','pagos','rentabilidad')
   AND NOT EXISTS (
     SELECT 1 FROM "dashboard_modules" m
      WHERE m."dashboard_id" = d."id" AND m."module" = d."slug"
   );

--> statement-breakpoint

-- Buscar «qué tableros salen en este módulo» es la consulta de cada navegación:
-- la hace el menú lateral y el botón de cada pantalla.
CREATE INDEX IF NOT EXISTS "dashboard_modules_module_idx"
  ON "dashboard_modules" ("module", "position");

--> statement-breakpoint

-- Y el módulo deja de vivir en la tabla del tablero: ya no le pertenece.
DROP INDEX IF EXISTS "dashboards_module_uq";

--> statement-breakpoint

ALTER TABLE "dashboards" DROP COLUMN IF EXISTS "module";
