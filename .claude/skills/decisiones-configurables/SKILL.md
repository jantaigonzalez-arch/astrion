---
name: decisiones-configurables
description: Cuando una regla que vas a escribir es una DECISIÓN DE NEGOCIO —quién puede pedir qué, a quién, cuántos, cuánto, si se bloquea o solo se avisa, si se permite o no— en este repositorio va como configuración por empresa, no fija en el código. Úsalo ANTES de escribir un `if` que decida por la empresa, al añadir un tipo, un límite o un permiso nuevo a un módulo, y cuando alguien pregunte si algo «se puede apagar» o «lo puede decidir cada cliente».
---

# Decisiones configurables

## La regla

**Una decisión de negocio no se escribe en el código: se lee de la
configuración de la empresa.**

Astraion es multiempresa. Lo que para un laboratorio es obvio —«nadie viaja a
prospectos», «un viaje, un destino», «el hotel tiene tope duro»— para otro es
justo lo contrario. Si la regla está en un `if`, la primera empresa que piense
distinto obliga a tocar el código, y el cambio le cae encima a todas las demás.

La pidió el usuario con estas palabras (2026-09-12, al rediseñar viáticos):
«todo esto debe ser configurable… todo lo que hagamos que se vea como toma de
decisiones sea configurable».

---

## 1 · Cómo reconocer una decisión de negocio

La prueba: **¿otra empresa podría querer, con toda razón, lo contrario?** Si sí,
es configurable.

Suelen contestar a una de estas preguntas:

| Pregunta | Ejemplo en el repo |
|---|---|
| ¿Quién puede? | qué roles piden viajes a contratos, visitas o prospectos |
| ¿A quién / a qué? | qué tipos de destino existen para esta empresa |
| ¿Cuántos? | cuántos contratos, clientes y prospectos por viático; horas del SLA general |
| ¿Cuánto? | presupuesto diario de un rubro, tarifas de mano de obra |
| ¿Se bloquea o se avisa? | pasarse del tope de un rubro (`blocksOverBudget`) |
| ¿Se permite o no? | mezclar contratos con visitas; contratos con un cliente en la lista 69-B |
| ¿Qué es qué? | qué pruebas hacen cliente a una organización |
| ¿De dónde sale? | tipo de cambio automático (Banxico) o manual |

**Lo que NO es configurable** son las invariantes: lo que, si una empresa lo
apagara, dejaría de ser un control o rompería los datos de todas.

- **Aislamiento entre empresas.** Nunca.
- **Separación de funciones.** Quien pide no firma: sin eso la autorización no
  autoriza nada.
- **Integridad del dato.** Un ticket de otro contrato no se le carga a éste; un
  CFDI sigue las reglas del SAT.
- **Seguridad.** Un operador de visita no escribe; una contraseña de otra empresa
  no se cambia desde ésta.

Si dudás entre las dos, preguntá al usuario: es exactamente la clase de pregunta
que le toca a él.

---

## 2 · Dónde vive el ajuste: ¿de quién es la decisión?

| La decide… | Vive en… | Ejemplo |
|---|---|---|
| la empresa entera | `settings` (fila `global` del esquema del inquilino) | topes de destinos, mezclar |
| la empresa, **por puesto** | lista de roles en `settings` | `viaticos_visitas_roles` |
| cada elemento de un catálogo | una columna del catálogo | `viatico_rubros.blocks_over_budget` |
| cada persona | permisos por módulo y nivel (`lib/permisos.ts`) | `viaticos: administrar` |

Por **rol** cuando es una política de gasto o de puesto («a qué puestos les paga
la empresa un viaje a un prospecto»). Por **permiso** cuando es acceso
(«quién entra a Compras»). No las mezcles: la 0033 quitó una segunda condición
por persona porque obligaba a tocar la hoja de permisos de cada vendedor después
de encender el interruptor de la empresa, y la pantalla tenía que confesarlo.

`settings` es de **negocio**, así que va en el esquema del inquilino (ver el
skill `modelo-de-datos`, §1). Nunca en `public`.

---

## 3 · La forma del ajuste

- **Listas de roles: `jsonb NOT NULL DEFAULT '[]'`. Lista vacía = apagado.** No
  un booleano aparte: dos columnas que contestan la misma pregunta acaban
  contradiciéndose (la 0033 quitó `viaticos_prospectos` por eso). Al leerla, se
  sanea contra el enum (`rolesGuardados` en `data/settings.ts`): `jsonb` puede
  traer un rol que esta versión ya no conoce.
- **Números: con `CHECK` de rango en la base y la misma validación en la acción**,
  con un mensaje que se entiende. El CHECK es la red; el mensaje es lo que ve la
  persona.
- **Booleanos: `NOT NULL DEFAULT …`.** «No configurado» y «no se permite» tienen
  que significar lo mismo; un tercer valor obliga a decidir de qué lado cae el
  nulo en cada consulta.
- **Un tipo guardado cuando la clasificación cambia con el tiempo.** Si lo que
  la política autorizó depende de algo que se mueve —el prospecto de hoy es el
  cliente de mañana—, guardá lo que era ese día (la columna `tipo` de
  `viatico_destinos`, 0037), atada a sus llaves con un CHECK.

---

## 4 · El valor de fábrica

**El que deja todo como estaba.** Una migración que enciende algo por omisión le
cambia la práctica a toda empresa que actualice sin haberlo pedido: a su equipo
le aparece una opción nueva en el formulario.

- Si ya existía el comportamiento → el valor de fábrica lo reproduce
  (`viaticos_contratos_roles` nace con todos los roles internos, porque cualquiera
  podía pedir viajes a contratos; los topes de destinos nacen en 1).
- Si es una posibilidad nueva de **gasto** → nace apagada: el valor por omisión
  de una política de gasto es el que no gasta (`viaticos_visitas_roles` nace
  vacío).

Y los **mismos valores en tres sitios**, o una empresa sin fila de ajustes se
comporta distinto que una recién migrada:

1. el `DEFAULT` de la columna en la migración;
2. el `.default(...)` en `src/lib/db/schema.ts`;
3. `DEFAULTS` en `src/lib/data/settings.ts` (empresa sin fila `global`).

---

## 5 · Dónde se hace cumplir: en el dominio

**La regla se hace cumplir en `src/lib/domain/`, no en la pantalla ni en la
acción.** La pantalla solo pinta; la acción solo sanea la forma.

- Si la pantalla no preguntara, enseñaría opciones que revientan al enviar.
- Si el dominio se fiara de la pantalla, bastaría un `curl` para saltársela.

Así que las dos preguntan, cada una para lo suyo: la página lee el ajuste para
**esconder** lo que no se puede (sin pestañas deshabilitadas que inviten a
preguntar por qué); el dominio lo lee **dentro de la transacción**
(`getSettings(tx)`) para **decidir**. Ver `vetoDestinos` en
`domain/viaticos.ts`.

Y el orden dentro del veto: **primero la política, después los datos.** Una regla
apagada se explica como regla («esta empresa no tiene habilitadas las visitas»),
no como «ese cliente no existe».

**Cada rechazo dice dónde se cambia la regla**: «Se configura en
Configuración → Viáticos». Quien choca con ella casi nunca es quien puede
cambiarla, y tiene que saber a quién ir.

---

## 6 · Quién la cambia, y dónde

- En **Configuración → <módulo>**: una PESTAÑA por módulo, no tarjetas sueltas
  en «Marca». Hoy hay tres —Viáticos, Servicio y Clientes—, y el usuario pidió
  la segunda y la tercera con estas palabras: las tarifas «deberían ir por
  separado en la configuración, para que sea solo para servicio».
- La guarda quien **administra ese módulo** (`viaticos: administrar`,
  `servicio: administrar`, `clientes: administrar`), no quien administra el
  sistema: quien decide cuánto se paga por noche de hotel es quien administra el
  gasto. Con el guardia de `configuracion`, el rol General ni siquiera podía
  abrir la pantalla.
- **Cómo se añade una pestaña así, en cuatro sitios**: la regla de ruta en
  `RUTAS` de `lib/permisos.ts` (gana por prefijo más largo sobre la de
  Configuración), la unión de permisos en el `layout` del área, la pestaña con
  su `modulo` en `settings-tabs.tsx`, y el guardia propio de la página. Y la
  acción que guarda pide ese mismo módulo — si no, la pantalla y la acción
  discrepan.
- **Una acción para una política entera**, no una por perilla, cuando son
  decisiones que se toman juntas (`guardarPoliticaViaticos`). Guardarlas por
  separado deja la política a medias entre un clic y otro.
- La tarjeta explica **qué significa cada valor** y qué pasa con el dinero
  («el gasto queda como costo comercial de esa empresa»), no solo el nombre.
- **Nunca `disabled` en un campo que se guarda.** Un control deshabilitado no se
  envía, y la acción lo toma por su valor de fábrica: guardar con él así apaga o
  reinicia el ajuste en silencio. Se usa `readOnly` (o se deja operable) y se
  dice por escrito cuándo no aplica.

### Cuando la decisión la usan muchas pantallas: léela dentro de la consulta

`ES_CLIENTE` decide quién es cliente en Clientes, Ventas, el selector del
negocio y los destinos de viáticos. Pasar el ajuste como parámetro a cada una
habría sido tocar veinte llamadas y olvidar la veintiuna. Se hizo al revés: la
expresión lee `settings` con una subconsulta sin correlación —Postgres la
resuelve una vez por consulta— y todas obedecen solas. Sirve para cualquier
regla que ya viva en UNA expresión SQL compartida.

### Un comentario que dice «el día que…» es una deuda con fecha

`SLA_HOURS = 2` llevaba escrito «el día que dos inquilinos prometan cosas
distintas, el sitio es `settings`». En un SaaS multiempresa ese día llega con el
segundo cliente. Si encuentras uno así, es un ajuste pendiente: dilo.

---

## 7 · Cómo se prueba

**Cada perilla en sus DOS estados.** Una regla configurable que solo se probó
encendida es media prueba: el camino apagado es justo el que la empresa que
pensaba distinto va a recorrer.

- En el probe de la acción de negocio (`scripts/_probe-acciones-<módulo>.ts`):
  el ajuste apagado rechaza con el mensaje que menciona Configuración; encendido,
  deja pasar; y en los límites numéricos, el borde y uno más.
- En el probe de la acción de configuración: guardia, nivel (un escalón menos
  del que pide), validación del rango, y que escriba exactamente lo marcado.
- **Guardá y restaurá la fila `settings`** que toques (`alLimpiar`): otras pruebas
  corren contra la misma base y esperan los valores de fábrica.

---

## Ejemplo trabajado: los destinos de viáticos (0033 → 0037)

| Decisión | Ajuste | De fábrica | Se hace cumplir en |
|---|---|---|---|
| quién viaja a contratos | `viaticos_contratos_roles` | todos los roles internos | `vetoDestinos` |
| quién visita clientes sin contrato | `viaticos_visitas_roles` | nadie | `vetoDestinos` |
| quién viaja a prospectos | `viaticos_prospectos_roles` | nadie | `vetoDestinos` |
| cuántos contratos por viaje | `viaticos_max_contratos` (1..20, CHECK) | 1 | `vetoDestinos` |
| cuántos clientes a visitar por viaje | `viaticos_max_visitas` (1..20, CHECK) | 1 | `vetoDestinos` |
| cuántos prospectos por viaje | `viaticos_max_prospectos` (1..20, CHECK) | 1 | `vetoDestinos` |
| mezclar contratos con lo comercial | `viaticos_mezclar_destinos` | no | `vetoDestinos` |

**Un tope por tipo y no uno para todo**, y es la lección de esta tabla: la
primera versión tenía un solo «destinos por viático», y el usuario pidió
separarlo —«cuántos clientes y cuántos prospectos»— porque son dos políticas.
Cuando una perilla junta dos decisiones que una empresa podría querer
distintas, son dos perillas.

Y el mínimo de cada tope es 1, no 0: apagar un tipo es vaciar su lista de roles.
Un 0 en el tope sería una segunda manera de decir lo mismo, que tarde o temprano
contradiría a la primera.

Y los de Clientes (0038) y Servicio:

| Decisión | Ajuste | De fábrica | Se hace cumplir en |
|---|---|---|---|
| SLA general de primera respuesta | `clientes_sla_horas` (1..720) | 2 h | `slaDueFrom` al crear el ticket |
| uso de CFDI de un expediente nuevo | `clientes_uso_cfdi_omision` | ninguno | prellenado; el SAT se valida igual |
| qué hace cliente a una organización | `clientes_pruebas` (≥1) | portal, pedido, contrato | `ES_CLIENTE`, dentro de la consulta |
| lista 69-B presunto / definitivo | `clientes_69b_*` | nada | `vetoLista69b` (contratos y tickets nuevos) |
| tarifas de mano de obra | `labor_*_per_hour` | — | `lib/profit.ts`; las guarda `servicio: administrar` |

Lo que **no** se hizo configurable, y por qué: que una visita sea a un cliente
**sin contrato vigente** (al que tiene contrato se le viaja por su contrato, o su
gasto se escapa de la utilidad que lo mide), y que el gasto de un destino de
contrato vaya a un ticket de ese contrato. Son integridad del dato, no política.
Tampoco las reglas fiscales del expediente —RFC, régimen, CP de la Constancia,
uso compatible con el régimen—: las pone el SAT, y una empresa que las apagara
solo conseguiría facturas rechazadas (ver el skill `clientes`).

---

## Antes de dar por buena una regla nueva

- [ ] ¿Otra empresa podría querer lo contrario? Entonces es un ajuste.
- [ ] ¿De quién es la decisión: empresa, puesto, elemento de catálogo o persona?
- [ ] ¿El valor de fábrica deja todo como estaba (o no gasta, si es gasto nuevo)?
- [ ] ¿El mismo valor en la migración, en `schema.ts` y en `DEFAULTS`?
- [ ] ¿Se hace cumplir en el dominio, y la pantalla solo esconde?
- [ ] ¿El rechazo dice dónde se cambia la regla?
- [ ] ¿La pantalla de configuración la guarda quien administra el módulo?
- [ ] ¿La prueba cubre la perilla en sus dos estados, y restaura `settings`?
