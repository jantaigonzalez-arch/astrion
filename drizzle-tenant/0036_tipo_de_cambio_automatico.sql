-- EL TIPO DE CAMBIO SE TOMA DE BANXICO, SALVO QUE LA EMPRESA DIGA LO CONTRARIO.
--
-- ESCRITA A MANO: ver el comentario de `drizzle.tenant.config.ts`.
--
-- Hasta aquí cada empresa escribía su tipo de cambio en Configuración →
-- Moneda (`usd_rate`). Con el FIX de Banxico cargado para toda la plataforma
-- (migración 0033 de `drizzle/`), el automático pasa a ser lo normal.
--
-- `true` por omisión, también para las empresas que ya existen: es lo que se
-- decidió. El tipo manual NO se borra: sigue ahí para quien apague el
-- automático —un tipo pactado con un cliente— y como respaldo si un día no
-- hubiera dato de Banxico. Lo ya estampado en negocios, órdenes y facturas no
-- cambia: cada uno guarda su propia paridad con su fecha.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "tipo_cambio_automatico" boolean NOT NULL DEFAULT true;
