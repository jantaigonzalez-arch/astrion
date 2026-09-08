-- VIAJAR A QUIEN TODAVÍA NO ES CLIENTE.
--
-- El módulo nació atado a un contrato: `contract_id NOT NULL`, y cada gasto
-- colgado de un ticket. Eso cubre el viaje de servicio —ir a reparar lo que ya
-- se vendió— y deja fuera el otro viaje que la empresa hace todas las semanas:
-- el vendedor o el ingeniero que va a ver a una planta que aún no ha comprado
-- nada. Ese viaje también cuesta hotel, vuelo y comidas, y hasta hoy no se
-- registraba en ninguna parte: o se metía a la fuerza en el contrato de otro
-- cliente —falseando su rentabilidad— o no se pedía por el sistema.
--
-- ---------------------------------------------------------------------------
-- EL ASUNTO ES UNO DE DOS, Y LA BASE LO EXIGE
--
-- Un viático es de un CONTRATO o de un PROSPECTO. Nunca de los dos, nunca de
-- ninguno. Es el mismo patrón que 0026 le aplicó a `notifications` al ampliarla
-- —dos llaves nulables y un CHECK que exige exactamente una— y por la misma
-- razón: sin él, un viático sin asunto se guardaría en silencio y aparecería en
-- el listado como un renglón que no lleva a ningún sitio.
--
-- No se resuelve con una columna `tipo` más las dos llaves. Sería un tercer
-- dato que puede contradecir a los otros dos, y el día que se contradigan
-- ninguna consulta sabrá a cuál creerle. La llave que esté puesta ES el tipo.
--
-- El NEGOCIO (`deal_id`) es aparte y es opcional: se viaja a prospectar antes
-- de que haya oportunidad abierta, y obligar a crear una para poder pedir el
-- viaje produciría negocios inventados de una línea. Cuando sí existe, el
-- viático se cuelga de ella y el costo se puede leer por oportunidad.
--
-- ---------------------------------------------------------------------------
-- EL GASTO SIN TICKET: LO DECIDE QUIEN FIRMA
--
-- En un viaje a prospecto NO HAY TICKET al que cargar la comida, porque no hay
-- servicio. `ticket_id` pasa a nulable y aparece el tercer destino posible:
--
--   ticket_id  → el gasto entra en la utilidad de ese servicio (lo de siempre)
--   deal_id    → el gasto es costo de esa oportunidad
--   ninguno    → GASTO COMERCIAL SUELTO
--
-- El CHECK admite como mucho uno. «Ninguno» es un destino legítimo y por eso no
-- se exige exactamente uno como en la cabecera: la mayoría de las comidas de un
-- viaje de prospección no son de una oportunidad concreta, son del viaje.
--
-- QUIEN CAPTURA PROPONE Y QUIEN FIRMA DISPONE. El ingeniero carga el gasto con
-- el destino que le parece; el aprobador lo reclasifica mientras el documento
-- está `en_revision`, antes de dar el visto bueno. Por eso hay rastro
-- (`reclassified_by_id`, `reclassified_at`) y no basta con `closed_by_id`: un
-- documento devuelto se revisa dos veces, a veces por personas distintas, y la
-- pregunta que se hace meses después no es quién cerró el viático sino quién
-- decidió que ESTA cena fuera costo de aquel negocio.
--
-- El gasto comercial suelto NO ENTRA en la utilidad de ningún ticket ni de
-- ningún contrato, porque no tiene dónde entrar. Sale en su propio informe.
-- Que no aparezca en la rentabilidad por contrato es correcto, no un hueco:
-- meterlo ahí repartido volvería a falsear justo lo que este módulo arregla.
--
-- ---------------------------------------------------------------------------
-- UN APROBADOR CON NOMBRE
--
-- Hasta ahora la solicitud se le anunciaba a TODO EL QUE PUDIERA ADMINISTRAR
-- viáticos y la firmaba el primero que la viera. Con dos personas funciona; con
-- seis, cada una supone que la mirará otra y el documento se queda quieto una
-- semana. Ahora quien pide elige a quién se lo manda, y SOLO ESA PERSONA firma.
--
-- `approver_id` es NULABLE a propósito, y no es dejadez:
--
--   · nulo = el comportamiento viejo, cualquiera que administre viáticos firma.
--     Es lo que deja que las filas que ya existen sigan su curso sin que haya
--     que inventarles un aprobador retroactivo que nadie eligió;
--   · para los viáticos NUEVOS lo exige `lib/domain/viaticos.ts`, que es donde
--     puede exigirse: comprobar que el elegido pueda administrar viáticos
--     requiere leer `memberships`, que vive en el plano de control, en otro
--     esquema. La base no puede hacer esa comprobación ni con un CHECK ni con
--     una llave foránea.
--
-- Se puede REASIGNAR, y hace falta que se pueda: un aprobador único es un punto
-- de bloqueo en cuanto se va de vacaciones. La reasignación la hace alguien que
-- administre viáticos y deja aviso al nuevo firmante.
--
-- ---------------------------------------------------------------------------
-- ESCRITA A MANO
--
-- Como todas las de inquilino: `drizzle-kit generate` con esa configuración
-- produce una migración rota. Ver `drizzle.tenant.config.ts` y la regla 4 de
-- AGENTS.md.

/* ═══════════════ La cabecera: contrato o prospecto ═══════════════ */

ALTER TABLE "viaticos" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "viaticos" ADD COLUMN "organization_id" uuid;--> statement-breakpoint

ALTER TABLE "viaticos" ADD COLUMN "deal_id" uuid;--> statement-breakpoint

ALTER TABLE "viaticos" ADD COLUMN "approver_id" uuid;--> statement-breakpoint

-- `restrict` sobre el prospecto, igual que sobre el contrato: borrar la ficha
-- de una empresa a la que se le viajó dejaría un gasto sin destinatario.
ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- `set null` sobre el negocio, en cambio: la oportunidad es una etiqueta de
-- gestión que se borra sin drama, y el viaje sigue siendo de esa empresa.
ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- `set null` sobre el aprobador: si la persona se da de baja, el viático no
-- desaparece — se queda sin firmante nombrado y hay que reasignarlo, que es
-- exactamente lo que pasó en la realidad.
ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_asunto_ck" CHECK (("contract_id" IS NOT NULL)::int + ("organization_id" IS NOT NULL)::int = 1);--> statement-breakpoint

-- Un negocio del CRM cuelga de un prospecto, no de un contrato. Sin esto se
-- podría guardar un viático de contrato con una oportunidad pegada y nadie
-- sabría qué significa esa combinación.
ALTER TABLE "viaticos" ADD CONSTRAINT "viaticos_negocio_ck" CHECK ("deal_id" IS NULL OR "organization_id" IS NOT NULL);--> statement-breakpoint

-- El costo de viaje de un prospecto, que es la contraparte de
-- `viaticos_contrato_idx`. Lo leen la ficha del prospecto y la del negocio.
CREATE INDEX "viaticos_organizacion_idx" ON "viaticos" ("organization_id");--> statement-breakpoint

-- «Lo que espera MI firma», que es la única bandeja nueva que aparece.
--
-- Mismo diseño que `viaticos_status_creado_idx` y por la lección de 0027: el
-- índice sirve al ORDER BY del listado —`created_at desc, id desc`— y no solo
-- al filtro, así que la página se llena recorriendo el índice en vez de leer
-- todo lo del aprobador y ordenarlo para quedarse con veinticinco.
CREATE INDEX "viaticos_aprobador_idx" ON "viaticos" ("approver_id", "created_at" DESC, "id" DESC);--> statement-breakpoint

/* ═══════════════ El gasto: ticket, negocio o nada ═══════════════ */

ALTER TABLE "viatico_expenses" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD COLUMN "deal_id" uuid;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD COLUMN "reclassified_by_id" uuid;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD COLUMN "reclassified_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_reclassified_by_id_users_id_fk" FOREIGN KEY ("reclassified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "viatico_expenses" ADD CONSTRAINT "viatico_expenses_destino_ck" CHECK (("ticket_id" IS NOT NULL)::int + ("deal_id" IS NOT NULL)::int <= 1);--> statement-breakpoint

/*
  EL ÍNDICE DEL TICKET SE REHACE PARCIAL.

  `viatico_expenses_ticket_idx` se creó cuando la columna era obligatoria, así
  que todas las filas le aportaban una entrada útil. Ahora el gasto comercial
  —que va a ser la mayoría en un viaje de prospección— la deja nula, y un btree
  indexa los nulos igual: el índice crecería con entradas que ninguna consulta
  puede usar, porque la única pregunta que se le hace es «los gastos de estos
  tickets» y esa pregunta implica NOT NULL.

  Con el `WHERE`, el índice solo guarda lo que se busca. La consulta de la
  utilidad por ticket lo sigue usando sin cambiar una letra.
*/
DROP INDEX IF EXISTS "viatico_expenses_ticket_idx";--> statement-breakpoint

CREATE INDEX "viatico_expenses_ticket_idx" ON "viatico_expenses" ("ticket_id") WHERE "ticket_id" IS NOT NULL;--> statement-breakpoint

-- El mismo criterio para el negocio, desde el primer día.
CREATE INDEX "viatico_expenses_negocio_idx" ON "viatico_expenses" ("deal_id") WHERE "deal_id" IS NOT NULL;--> statement-breakpoint

/* ═══════════════ El interruptor de la empresa ═══════════════ */

/*
  APAGADO DE FÁBRICA, Y NO ES TIMIDEZ.

  Pagar viajes a quien todavía no compra es una decisión de la empresa, no una
  función del programa: hay quien lo hace y quien no. Encenderlo por omisión le
  cambiaría la práctica a cualquiera que actualice sin haberlo pedido —le
  aparecería una opción nueva en el formulario de todo su equipo—, y el módulo
  se desplegó hace dos semanas justamente para controlar el gasto de viaje.

  `NOT NULL DEFAULT false` y no nulable: «no configurado» y «no se permite»
  significan lo mismo aquí, y un tercer valor solo obligaría a elegir de qué
  lado cae el nulo en cada consulta que lo lea.
*/
ALTER TABLE "settings" ADD COLUMN "viaticos_prospectos" boolean DEFAULT false NOT NULL;
