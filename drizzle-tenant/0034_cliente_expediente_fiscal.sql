-- EL CLIENTE DEJA DE SER UN DIRECTORIO Y PASA A SER UN EXPEDIENTE FISCAL.
--
-- ESCRITA A MANO. Regla 4 de AGENTS.md.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO HAY UNA TABLA `cliente`
--
-- La entidad ya existe: `crm_organizations`, con las organizaciones que trajo
-- el padrón de SAE, su RFC y su domicilio desarmado nodo por nodo del SAT. Una
-- tabla `cliente` al lado habría partido el padrón en dos y obligado a mantener
-- sincronizadas dos verdades sobre la misma empresa — y la que se desincroniza
-- siempre es la que no se está mirando.
--
-- Lo que faltaba no era la entidad: era el expediente. En CFDI 4.0 un cliente
-- no está dado de alta cuando tiene nombre y teléfono, sino cuando sus cuatro
-- datos fiscales coinciden con su Constancia de Situación Fiscal.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO HAY LLAVES FORÁNEAS A LOS CATÁLOGOS DEL SAT
--
-- `regimen_fiscal`, `uso_cfdi_default`, `forma_pago_default` y `pais_residencia`
-- guardan claves de catálogos que viven en `public` (migración 0032 de
-- plataforma). Sería natural apuntarles con una FK y NO se hace, por dos
-- razones distintas y las dos de peso:
--
--   1. El adaptador que aplica estas migraciones por esquema quita la
--      calificación `"public".` de toda FK que no apunte al plano de control
--      (ver `prepareStatements`). Una FK a `sat_regimen_fiscal` acabaría
--      apuntando a una tabla inexistente DENTRO del esquema del inquilino.
--
--   2. Y aunque se arreglara: los catálogos llegan vacíos y se cargan desde los
--      archivos del SAT. Una FK convertiría «todavía no puedo VALIDAR el
--      régimen» en «no puedes dar de alta un cliente», que es un fallo mucho
--      peor. La integridad de estas claves se comprueba en la capa de dominio,
--      que sabe distinguir «inválido» de «no verificable» y lo dice.
--
-- Es el mismo criterio que ya seguía `crm_organizations.country`, que guarda la
-- clave de `c_Pais` sin apuntar a nada.
--
-- ---------------------------------------------------------------------------
-- NO MIGRA NINGÚN DATO, Y ESO TAMBIÉN ES UNA DECISIÓN
--
-- Sería tentador rellenar `cliente_fiscal` con el `tax_id` y el `postal_code`
-- que ya tienen las organizaciones. No se hace aquí. De las 147 con RFC, 75
-- llevan el régimen de capital dentro del nombre y ninguna tiene régimen
-- fiscal, que es obligatorio. Una migración que las diera por altas las dejaría
-- marcadas como expediente completo con datos que el SAT rechazaría.
--
-- El traslado va aparte, con reporte de incidencias y sin dar nada por bueno en
-- silencio: `npm run clientes:adoptar`. Regla 9 de AGENTS.md.

CREATE TYPE "public"."cliente_rol_fiscal" AS ENUM('normal', 'publico_general', 'extranjero');--> statement-breakpoint
CREATE TYPE "public"."persona_tipo" AS ENUM('fisica', 'moral', 'extranjero');--> statement-breakpoint
CREATE TYPE "public"."domicilio_tipo" AS ENUM('fiscal', 'envio', 'facturacion', 'sucursal');--> statement-breakpoint
CREATE TYPE "public"."validacion_resultado" AS ENUM('no_validado', 'valido', 'rfc_inexistente', 'nombre_no_coincide', 'cp_no_coincide', 'error');--> statement-breakpoint
CREATE TYPE "public"."lista69b_estatus" AS ENUM('no_listado', 'presunto', 'desvirtuado', 'definitivo', 'sentencia_favorable');--> statement-breakpoint

CREATE TABLE "cliente_fiscal" (
	"organization_id"     uuid PRIMARY KEY NOT NULL,
	"rol_fiscal"          "cliente_rol_fiscal" DEFAULT 'normal' NOT NULL,
	"persona_tipo"        "persona_tipo" NOT NULL,
	"rfc"                 varchar(13) NOT NULL,
	"nombre_fiscal"       text NOT NULL,
	"nombre_capturado"    text,
	"curp"                varchar(18),
	"regimen_fiscal"      varchar(3) NOT NULL,
	"cp_fiscal"           varchar(5) NOT NULL,
	"pais_residencia"     varchar(3) DEFAULT 'MEX' NOT NULL,
	"num_reg_id_trib"     varchar(40),
	"uso_cfdi_default"    varchar(5),
	"forma_pago_default"  varchar(2),
	"metodo_pago_default" varchar(3),
	"moneda_default"      varchar(3) DEFAULT 'MXN' NOT NULL,
	"matriz_id"           uuid,
	"creado_en"           timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en"      timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por"     uuid
);--> statement-breakpoint

ALTER TABLE "cliente_fiscal" ADD CONSTRAINT "cliente_fiscal_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."crm_organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cliente_fiscal" ADD CONSTRAINT "cliente_fiscal_matriz_id_fk"
  FOREIGN KEY ("matriz_id") REFERENCES "public"."cliente_fiscal"("organization_id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "cliente_fiscal_rfc_idx" ON "cliente_fiscal" ("rfc");--> statement-breakpoint
CREATE INDEX "cliente_fiscal_matriz_idx" ON "cliente_fiscal" ("matriz_id");--> statement-breakpoint

-- RFC + CP y NO el RFC solo: matriz y sucursal comparten RFC con toda
-- legitimidad y son dos fichas distintas. Lo que no puede repetirse es el mismo
-- contribuyente en el mismo domicilio fiscal, que ya es la ficha duplicada.
CREATE UNIQUE INDEX "cliente_fiscal_rfc_cp_idx" ON "cliente_fiscal" ("rfc", "cp_fiscal");--> statement-breakpoint

CREATE TABLE "cliente_comercial" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"clave"           varchar(10),
	"clasificacion"   varchar(5),
	"zona"            varchar(10),
	"maneja_credito"  boolean DEFAULT false NOT NULL,
	"dias_credito"    smallint DEFAULT 0 NOT NULL,
	"limite_credito"  numeric(14, 2) DEFAULT '0' NOT NULL,
	"descuento_pct"   numeric(5, 2) DEFAULT '0' NOT NULL,
	"cuenta_contable" varchar(30),
	"actualizado_en"  timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "cliente_comercial" ADD CONSTRAINT "cliente_comercial_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."crm_organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "cliente_comercial_clave_idx" ON "cliente_comercial" ("clave");--> statement-breakpoint

CREATE TABLE "cliente_domicilio" (
	"id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tipo"            "domicilio_tipo" NOT NULL,
	"es_default"      boolean DEFAULT false NOT NULL,
	"calle"           text,
	"num_exterior"    varchar(55),
	"num_interior"    varchar(55),
	"colonia"         text,
	"colonia_clave"   varchar(4),
	"municipio"       text,
	"localidad"       text,
	"estado"          text,
	"cp"              varchar(5) NOT NULL,
	"pais"            varchar(3) DEFAULT 'MEX' NOT NULL,
	"referencia"      text,
	"entre_calles"    text,
	"creado_en"       timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "cliente_domicilio" ADD CONSTRAINT "cliente_domicilio_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."crm_organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "cliente_domicilio_org_idx" ON "cliente_domicilio" ("organization_id");--> statement-breakpoint

-- Un solo domicilio FISCAL por cliente, garantizado por la base y no por un
-- disparador: un índice único PARCIAL deja tantos de envío como haga falta y no
-- necesita código que nadie pueda probar sin levantar Postgres.
CREATE UNIQUE INDEX "cliente_domicilio_fiscal_unico_idx"
  ON "cliente_domicilio" ("organization_id") WHERE "tipo" = 'fiscal';--> statement-breakpoint

CREATE TABLE "cliente_validacion_sat" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"resultado"       "validacion_resultado" DEFAULT 'no_validado' NOT NULL,
	"lista_69b"       "lista69b_estatus" DEFAULT 'no_listado' NOT NULL,
	"validado_en"     timestamp with time zone,
	"origen"          varchar(30),
	"payload_crudo"   jsonb,
	"hash_datos"      varchar(64)
);--> statement-breakpoint

ALTER TABLE "cliente_validacion_sat" ADD CONSTRAINT "cliente_validacion_sat_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."crm_organizations"("id") ON DELETE cascade;--> statement-breakpoint

-- Append-only. Aquí no se hace `update` nunca: un veredicto ocurrió, y la
-- historia de por qué un cliente dejó de ser válido es justo lo que hace falta
-- cuando alguien pregunta desde cuándo no se le puede facturar.
CREATE TABLE "cliente_validacion_sat_log" (
	"id"              bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"resultado"       "validacion_resultado" NOT NULL,
	"lista_69b"       "lista69b_estatus" NOT NULL,
	"validado_en"     timestamp with time zone DEFAULT now() NOT NULL,
	"origen"          varchar(30),
	"payload_crudo"   jsonb,
	"hash_datos"      varchar(64)
);--> statement-breakpoint

CREATE INDEX "cliente_validacion_log_org_idx"
  ON "cliente_validacion_sat_log" ("organization_id", "validado_en" DESC);--> statement-breakpoint

CREATE TABLE "cliente_campo_libre" (
	"organization_id" uuid NOT NULL,
	"clave"           varchar(60) NOT NULL,
	"valor"           text,
	CONSTRAINT "cliente_campo_libre_pk" PRIMARY KEY ("organization_id", "clave")
);--> statement-breakpoint

ALTER TABLE "cliente_campo_libre" ADD CONSTRAINT "cliente_campo_libre_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."crm_organizations"("id") ON DELETE cascade;
