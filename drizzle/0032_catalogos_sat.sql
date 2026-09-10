-- LOS CATÁLOGOS DEL SAT, UNA VEZ PARA TODA LA PLATAFORMA.
--
-- ESCRITA A MANO. Ver la regla 4 de AGENTS.md: `drizzle-kit generate` compara
-- contra un snapshot de hace seis migraciones y produce una que las REHACE
-- todas, lo que aborta el contenedor `migrate` y deja el sitio sin levantar.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTAS TABLAS SÍ VAN EN `public`
--
-- El plano de control tiene una regla que sostiene el aislamiento entero:
-- ninguna tabla de NEGOCIO vive en `public`, para que una consulta sin
-- inquilino activo falle en vez de devolver datos de otro cliente.
--
-- Estas no la rompen. No contienen datos de nadie: son los catálogos que el SAT
-- publica para todo México. Leerlos sin inquilino no filtra nada porque no hay
-- nada de ningún inquilino dentro.
--
-- Y duplicarlos por esquema sería insostenible: `c_CodigoPostal` trae unos
-- 95 000 renglones y `c_Colonia` unos 145 000. Con veinte inquilinos son casi
-- cinco millones de filas idénticas que habría que actualizar una por una cada
-- vez que el SAT publica una versión.
--
-- ---------------------------------------------------------------------------
-- LLEGAN VACÍAS, Y ESO ES CORRECTO
--
-- Esta migración crea la forma; los datos los carga `npm run sat:catalogos`
-- desde los archivos oficiales del Anexo 20. No se siembran aquí valores
-- «de referencia» porque un catálogo fiscal a medias es peor que uno vacío:
-- vacío, el sistema DICE que no puede validar; a medias, valida mal y con
-- aplomo.
--
-- `sat_catalogo` es lo que hace visible esa diferencia — registra qué hay
-- cargado, de qué archivo y con qué hash.

CREATE TABLE IF NOT EXISTS "sat_catalogo" (
  "nombre"       varchar(40) PRIMARY KEY,
  "version"      varchar(60),
  "filas"        integer NOT NULL DEFAULT 0,
  "origen"       text,
  "hash_archivo" varchar(64),
  "cargado_en"   timestamp with time zone NOT NULL DEFAULT now(),
  "cargado_por"  uuid
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_regimen_fiscal" (
  "clave"           varchar(3) PRIMARY KEY,
  "descripcion"     text NOT NULL,
  "aplica_fisica"   boolean NOT NULL,
  "aplica_moral"    boolean NOT NULL,
  "vigencia_inicio" date,
  "vigencia_fin"    date
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_uso_cfdi" (
  "clave"           varchar(5) PRIMARY KEY,
  "descripcion"     text NOT NULL,
  "aplica_fisica"   boolean NOT NULL,
  "aplica_moral"    boolean NOT NULL,
  "vigencia_inicio" date,
  "vigencia_fin"    date
);--> statement-breakpoint

-- La matriz que decide el CFDI40158. Se DERIVA de la columna «Régimen Fiscal
-- Receptor» de c_UsoCFDI; no se escribe a mano ni aquí ni en ningún sitio.
CREATE TABLE IF NOT EXISTS "sat_uso_regimen" (
  "uso_cfdi"       varchar(5) NOT NULL REFERENCES "sat_uso_cfdi"("clave") ON DELETE CASCADE,
  "regimen_fiscal" varchar(3) NOT NULL REFERENCES "sat_regimen_fiscal"("clave") ON DELETE CASCADE,
  CONSTRAINT "sat_uso_regimen_pk" PRIMARY KEY ("uso_cfdi", "regimen_fiscal")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sat_uso_regimen_regimen_idx"
  ON "sat_uso_regimen" ("regimen_fiscal");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_codigo_postal" (
  "cp"                          varchar(5) PRIMARY KEY,
  "estado"                      varchar(3),
  "municipio"                   varchar(3),
  "localidad"                   varchar(2),
  "huso_horario"                text,
  "estimulo_franja_fronteriza"  numeric(4,3)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_colonia" (
  "cp"     varchar(5) NOT NULL REFERENCES "sat_codigo_postal"("cp") ON DELETE CASCADE,
  "clave"  varchar(4) NOT NULL,
  "nombre" text NOT NULL,
  CONSTRAINT "sat_colonia_pk" PRIMARY KEY ("cp", "clave")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_forma_pago" (
  "clave"           varchar(2) PRIMARY KEY,
  "descripcion"     text NOT NULL,
  "vigencia_inicio" date,
  "vigencia_fin"    date
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_metodo_pago" (
  "clave"       varchar(3) PRIMARY KEY,
  "descripcion" text NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sat_pais" (
  "clave"       varchar(3) PRIMARY KEY,
  "descripcion" text NOT NULL
);
