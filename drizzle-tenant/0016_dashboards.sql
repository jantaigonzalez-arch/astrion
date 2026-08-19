-- Dashboards por módulo, compuestos por el usuario.
--
-- ── UN DASHBOARD ES UNA PANTALLA ──────────────────────────────────────────
--
-- No hay tabla de bloques. Los bloques de un dashboard son filas de
-- `analysis_placements` con `screen = 'dashboard:<modulo>'`, exactamente igual
-- que los que salen en una pantalla de trabajo.
--
-- Es lo que permite que TODO lo que ya existe siga sirviendo sin tocarlo: la
-- mezcla de colocaciones de fábrica con las del usuario, el orden por
-- `position`, el encendido y apagado, el origen (fábrica / sistema / usuario) y
-- las recomendaciones. Una tabla nueva de bloques habría duplicado esa lógica
-- entera para acabar haciendo lo mismo con otros nombres.
--
-- Lo único que le faltaba a un bloque para poder componer un dashboard era el
-- ancho: en una pantalla de trabajo los análisis van uno debajo de otro, y en
-- un dashboard media pantalla es la mitad del valor.

ALTER TABLE "analysis_placements"
  ADD COLUMN IF NOT EXISTS "width" varchar(6) NOT NULL DEFAULT 'full';

--> statement-breakpoint

-- El dashboard en sí: su nombre y si está publicado.
--
-- ── QUÉ SIGNIFICA PUBLICAR ────────────────────────────────────────────────
--
-- Que el resto del equipo pueda verlo. Antes de publicarse, el botón de
-- «Dashboard» solo aparece para quien lo está componiendo: nadie debería
-- encontrarse un tablero a medio ordenar porque alguien salió a comer.
--
-- Publicar NO congela una versión. Editar después de publicar cambia lo que el
-- equipo ve, en el acto. Es una decisión y conviene que esté escrita: un
-- borrador aparte —dos juegos de colocaciones, uno vivo y otro en edición— es
-- una función de verdad, con su propia manera de confundir («¿por qué no se ve
-- mi cambio?»). A este tamaño, el gesto que hace falta es «esto ya está listo
-- para que lo vean», y eso es una fecha, no una copia.
CREATE TABLE IF NOT EXISTS "dashboards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- El módulo del ERP: `ventas`, `clientes`, `rentabilidad`…
  "module" varchar(40) NOT NULL,
  "title" varchar(120) NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Uno por módulo. Dos dashboards del mismo módulo obligarían a elegir cuál abre
-- el botón, y esa elección no la puede tomar nadie con criterio.
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_module_uq" ON "dashboards" ("module");

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "dashboards"
    ADD CONSTRAINT "dashboards_published_by_id_users_id_fk"
    FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
