-- EL TIPO DE CAMBIO DE BANXICO, UNA VEZ PARA TODA LA PLATAFORMA.
--
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md: `drizzle-kit generate` compara
-- contra un snapshot viejo y produce una migración que rehace todas.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ EN `public`
--
-- Por la misma razón que los catálogos del SAT (0032): no es dato de ninguna
-- empresa. El FIX lo determina Banco de México para todo el país, y guardarlo
-- por esquema sería copiar la misma cifra una vez por inquilino y actualizarla
-- en todas. Lo carga `scripts/tipo-de-cambio.ts` desde la API del SIE de
-- Banxico; las empresas lo leen con `referenciaCache`.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE GUARDA: LA FECHA DE DETERMINACIÓN, NO LA DE PUBLICACIÓN
--
-- El dólar es la serie SF43718, el FIX por FECHA DE DETERMINACIÓN: una cifra
-- por día hábil bancario. El Diario Oficial lo publica el día hábil siguiente,
-- y el que vale para una obligación fiscal es el publicado el día anterior
-- (art. 20 del CFF). Esa cuenta —qué FIX estaba publicado en tal fecha— se hace
-- al leer (`vigenteEn`), no aquí: guardada la fecha real, se puede contestar
-- cualquier pregunta; guardada ya «corrida», no se puede deshacer.
--
-- Se descartó SF60653 aunque se llame igual: va por fecha de LIQUIDACIÓN (dos
-- días hábiles después) y trae un valor para cada día del calendario, incluidos
-- los futuros. Medido el 10/09/2026: su último dato era del 14/09.
--
-- El euro es SF46410, la cotización del día.

CREATE TABLE IF NOT EXISTS "tipo_de_cambio" (
  "moneda"     varchar(3)    NOT NULL,
  "fecha"      date          NOT NULL,
  "valor"      numeric(12,6) NOT NULL,
  "serie"      varchar(12)   NOT NULL,
  "cargado_en" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tipo_de_cambio_pk" PRIMARY KEY ("moneda", "fecha"),
  -- Pesos por unidad. Un cero o un negativo es un error de lectura, no una
  -- cotización: que lo rechace la base y no solo el cargador.
  CONSTRAINT "tipo_de_cambio_valor_positivo" CHECK ("valor" > 0)
);
