-- LOS RUBROS DEJAN DE SER DEL CÓDIGO Y PASAN A SER DE LA EMPRESA.
--
-- La 0026 cerró las categorías en un enum y dejó escrito por qué: «texto libre
-- produce "Hotel", "hotel" y "HOSPEDAJE SLP" en el mismo trimestre, y a partir
-- de ahí no hay forma de sumar en qué se va el dinero de los viajes».
--
-- Esa razón sigue siendo cierta y esta migración NO la contradice. Lo que
-- cambia no es que se pueda teclear el rubro —se sigue eligiendo de una lista—
-- sino QUIÉN manda la lista: antes el código, ahora la empresa. Una consultora
-- que factura «casetas» aparte y un laboratorio que necesita «paquetería» no
-- pueden esperar a un despliegue para tener su renglón, y hasta hoy la única
-- salida era meterlo todo en `otros`, que es exactamente donde el análisis se
-- pierde. Un catálogo administrado conserva la propiedad que importa —dos
-- personas clasifican igual porque eligen del mismo sitio— y quita la que
-- estorbaba.
--
-- ---------------------------------------------------------------------------
-- EL PRESUPUESTO ES POR DÍA, Y SE COMPARA CONTRA EL TOTAL DEL RUBRO EN EL VIAJE
--
-- `daily_budget_mxn` es lo que la empresa autoriza por día para ese rubro:
-- hotel 1 500 la noche, comida 500 el día. El tope del viaje NO se guarda: se
-- calcula como presupuesto × días entre salida y regreso, así que un viaje de
-- dos días y uno de ocho se miden con el mismo número sin tener que mantener
-- dos.
--
-- Y se compara contra la SUMA del rubro en ese viático, no contra cada gasto
-- suelto. Una factura de hotel por tres noches es un solo renglón de 4 500 que
-- contra un tope diario de 1 500 se vería como un exceso del triple, cuando no
-- lo es. Comparar totales es lo único que da una respuesta que se sostiene.
--
-- NULO = SIN TOPE. No es «cero»: cero significaría que ese rubro no se paga, y
-- convertir «no lo hemos definido» en «no se paga» marcaría en rojo todos los
-- gastos de una empresa que todavía no configuró nada.
--
-- ---------------------------------------------------------------------------
-- PASARSE NO BLOQUEA: SE MARCA
--
-- El gasto se registra igual y sale señalado en la comprobación con cuánto se
-- pasó, para que decida quien firma. Un hotel caro por un congreso existe, y
-- bloquear la captura no hace que el gasto no ocurra: hace que se registre en
-- otro rubro, que es la manera más rápida de arruinar el análisis que este
-- catálogo viene a permitir.
--
-- ---------------------------------------------------------------------------
-- `other_label` SE VUELVE `note`, Y SU CHECK SE MUDA AL DOMINIO
--
-- La 0026 exigía por CHECK que `otros` llevara etiqueta, y su comentario decía
-- —con razón— que una validación que vive solo en la pantalla se salta desde
-- cualquier otro camino. Ahora la regla es «los rubros marcados
-- `requires_note` exigen nota», y eso depende de OTRA TABLA: un CHECK no puede
-- leerla.
--
-- Así que baja al dominio, junto a `firmaValida()` y por el mismo motivo que
-- aquella —depende de un dato que la restricción no alcanza— y no por
-- comodidad. Lo que se pierde es real y se dice aquí para que nadie lo
-- descubra: un `insert` a mano puede dejar una nota vacía en un rubro que la
-- pide.
--
-- ---------------------------------------------------------------------------
-- LA COLUMNA VIEJA SE VA, Y NO SE PIERDE NADA
--
-- `category` se rellena en `rubro_id` por su clave antes de borrarse, así que
-- la información viaja entera: el gasto que decía `hotel` queda apuntando al
-- rubro cuya `key` es `hotel`. Se borra en vez de dejarse por si acaso porque
-- dos columnas que dicen lo mismo acaban diciendo cosas distintas, y entonces
-- ninguna consulta sabe a cuál creerle.
--
-- Medido antes de escribir esto: producción tiene 0 gastos cargados y la copia
-- local 1. El respaldo no es la columna: es que el `update` de relleno va en la
-- misma transacción que el `drop`.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO
--
-- Como todas, y desde la 0029 de plataforma eso vale también para `drizzle/`:
-- ver la regla 4 de AGENTS.md.

CREATE TABLE "viatico_rubros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	/*
	  La clave de máquina. Los cinco de fábrica la traen del enum viejo, y por
	  eso el relleno de `rubro_id` puede hacerse con un join por nombre.

	  Es inmutable y NO es lo que se enseña: el nombre se edita —«Hotel» puede
	  pasar a «Hospedaje»— sin que se mueva ni un gasto ya clasificado. Un
	  catálogo donde renombrar rompe el histórico no sirve para nada.
	*/
	"key" varchar(40) NOT NULL UNIQUE,
	"name" varchar(80) NOT NULL,
	/** Lo que se autoriza por DÍA. Nulo = sin tope. Ver la cabecera. */
	"daily_budget_mxn" numeric(12,2),
	/** Como el viejo `otros`: obliga a decir de qué se trata. */
	"requires_note" boolean DEFAULT false NOT NULL,
	/*
	  Se DESACTIVA, no se borra. Un rubro con gastos encima no se puede quitar
	  —la llave foránea es `restrict`— y aunque se pudiera, borrarlo dejaría el
	  histórico sin nombre. Inactivo desaparece del formulario y sigue sumando
	  en los informes de lo ya capturado.
	*/
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viatico_rubros_presupuesto_ck" CHECK ("daily_budget_mxn" IS NULL OR "daily_budget_mxn" > 0)
);--> statement-breakpoint

CREATE INDEX "viatico_rubros_orden_idx" ON "viatico_rubros" ("active", "position", "name");--> statement-breakpoint

/*
  LOS CINCO DE FÁBRICA, con los mismos nombres y el mismo significado que
  tenían en el enum. Sin presupuesto: la empresa lo pone cuando lo decida, y
  hasta entonces nada se marca en rojo.

  `refacciones` conserva su razón de existir, que la 0026 explicó: es la pieza
  comprada en ruta porque no podía esperar a una orden de compra. No entra al
  inventario pero sí es costo del servicio, y sin renglón propio acababa en
  `otros` y desaparecía del análisis.
*/
INSERT INTO "viatico_rubros" ("key", "name", "requires_note", "position") VALUES
  ('hotel',       'Hotel',       false, 1),
  ('transporte',  'Transporte',  false, 2),
  ('comida',      'Comida',      false, 3),
  ('refacciones', 'Refacciones', false, 4),
  ('otros',       'Otros',       true,  5);--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD COLUMN "rubro_id" uuid;--> statement-breakpoint

-- El relleno. Va antes del `drop` y en la misma transacción que él.
UPDATE "viatico_expenses" g
   SET "rubro_id" = r."id"
  FROM "viatico_rubros" r
 WHERE r."key" = g."category"::text;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ALTER COLUMN "rubro_id" SET NOT NULL;--> statement-breakpoint

/*
  `restrict` y no `cascade`: borrar un rubro no puede llevarse por delante los
  gastos que lo usaron. Es la misma decisión que ya protege al ticket y al
  contrato en este módulo — que falle es la respuesta correcta.
*/
ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_rubro_id_fk" FOREIGN KEY ("rubro_id") REFERENCES "viatico_rubros"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "viatico_expenses_rubro_idx" ON "viatico_expenses" ("rubro_id");--> statement-breakpoint

-- `other_label` pasa a ser la nota de cualquier rubro que la pida, no solo de
-- «otros». Se renombra en vez de crear una columna nueva y migrar: es el mismo
-- dato con un alcance más ancho.
ALTER TABLE "viatico_expenses" DROP CONSTRAINT "viatico_expenses_otros_ck";--> statement-breakpoint

ALTER TABLE "viatico_expenses" RENAME COLUMN "other_label" TO "note";--> statement-breakpoint

ALTER TABLE "viatico_expenses" DROP COLUMN "category";--> statement-breakpoint

DROP TYPE "viatico_categoria";
