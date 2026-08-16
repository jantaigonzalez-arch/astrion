# Arquitectura SaaS multi-empresa con laboratorio de ML

> **Documento vivo.** Está escrito para ser corregido. Cada decisión lleva su
> porqué y su costo, para que discutir sea discutir el fundamento y no el gusto.
>
> Estado: plan aprobado en sus 4 decisiones de fondo · ejecución iniciada
> Contexto previo: [ARQUITECTURA.md](./ARQUITECTURA.md) (Fase 0, monolito de un solo cliente)

---

## De dónde partimos

Evoelution funciona y se queda como **prueba de concepto**: pasa a ser el primer
inquilino de la plataforma, no un caso especial en el código.

Lo que ya está resuelto y sostiene todo lo demás:

- Escrituras transaccionales, folios por secuencia, ledger de inventario
- `domain_events` append-only — **la materia prima del ML** y la única copia del pasado
- 34 índices sobre los predicados reales
- 602 tickets, 257 equipos, 54 contratos y 161 clientes reales importados

Lo que **no** está resuelto y bloquea el producto multi-empresa:

| | |
|---|---|
| 26 de 33 tablas | sin ninguna noción de a quién pertenecen |
| 8 restricciones únicas | globales (`tickets.reference`, `contracts.number`, `spare_parts.part_number`…) |
| 2 secuencias de folio | compartidas: dos empresas se pisarían el contador |
| `settings` | **una sola fila global** — hoy todas compartirían la tarifa de mano de obra |
| 110 consultas | ninguna filtra por empresa |
| Sesión | sabe el rol, no sabe en qué empresa está |

---

## Las cuatro decisiones de fondo

### 1. Aislamiento: un esquema de Postgres por inquilino

```
postgres
├── public                    ← plano de control (la plataforma)
│   ├── tenants               inquilinos, plan, consentimiento de ML
│   ├── companies             entidades legales dentro de un inquilino
│   ├── users                 identidad global (correo único en toda la plataforma)
│   ├── memberships           usuario × inquilino × rol
│   ├── tenant_schemas        mapa inquilino → nombre de esquema
│   ├── ml_models             registro de modelos
│   └── platform_events       auditoría del plano de control
│
├── tenant_evoelution         ← datos de negocio (las 33 tablas de hoy)
│   ├── tickets, contracts, crm_*, equipment, spare_parts…
│   ├── domain_events
│   ├── ml_predictions        predicciones sobre entidades de ESTE inquilino
│   └── ml_outcomes           el resultado real, para medir deriva
│
└── tenant_acme               ← idem, aislado
```

**Cómo se activa el esquema.** Cada petición abre una transacción y fija el
`search_path`. Las tablas de negocio se declaran **sin calificar**, así que la
misma consulta resuelve al esquema del inquilino activo:

```ts
await withTenant(async (tx) => {
  return tx.query.tickets.findMany();   // → tenant_evoelution.tickets
});
```

Tres consecuencias que conviene tener presentes:

- **Las 110 consultas existentes no necesitan filtro por empresa.** El
  `search_path` hace el trabajo. Con esquema compartido habría que auditar cada
  una y un solo olvido sería una fuga silenciosa.
- **Las 8 unicidades globales y las 2 secuencias se arreglan solas.** Cada
  esquema tiene su copia, así que el contador de cada empresa arranca en uno y
  nadie deduce el volumen de operación de nadie. Solo `users.email` sigue
  siendo global, que es lo correcto.

  El **contador** quedó aislado desde el principio; el **prefijo** no. Estaba
  escrito `EVO-` en el código, así que el primer ticket de cualquier otra
  empresa habría nacido con la marca de Evoelution. Ahora vive en
  `tenants.folio_prefix`, junto al logo, porque es lo mismo: el folio es lo que
  el cliente escribe en un correo y lo que aparece en un reporte de servicio
  firmado. Se fija al dar de alta la empresa —derivado del nombre, `ACME
  Laboratorios` → `ACM`— y no al emitir el primer folio, porque un inquilino
  sin prefijo emitiría `null-000001` y ese folio ya no se corrige. Cambiarlo
  después **no reescribe los ya emitidos**: un documento emitido no se altera,
  así que la empresa queda con dos series y la UI lo advierte.
- **Falla cerrado.** Las tablas de negocio **no existen en `public`**. Si alguien
  consulta sin activar inquilino, Postgres responde *relation does not exist*:
  un error ruidoso, nunca los datos de otro cliente.

**Lo que cuesta, dicho sin adornos:** cada migración corre N veces y hay que
construir el runner, porque `drizzle-kit` no sabe hacerlo. Y a partir de unos
cientos de inquilinos, el número de tablas empieza a pesar en el planner y en
los respaldos. Ese es el techo conocido de este modelo; se cruza moviendo
inquilinos grandes a su propia base, sin cambiar el código de la app.

> **Sobre la alternativa.** Recomendé esquema compartido con `tenant_id` + RLS,
> por ser más barato de operar y por dejar el ML cruzado trivial. La decisión fue
> esquema por inquilino, y es defendible: los clientes son laboratorios
> farmacéuticos, IMSS y gobierno, donde "sus datos están en un esquema aparte y
> el respaldo es solo suyo" cierra ventas. El costo del ML cruzado se resuelve
> en el plano analítico, no en el transaccional (ver §3).

### 2. Dos niveles: inquilino → empresas

`tenant` es la **frontera de aislamiento y de facturación del SaaS**.
`company` es la **entidad legal** que emite documentos, con su RFC.

```
tenant "Evoelution"          ← un esquema, un contrato con la plataforma
  ├── company Evoelution MX  ← RFC, folios fiscales, CFDI
  └── company Evoelution CO  ← NIT, su propia numeración

tenant "ACME Labs"           ← otro esquema, aislado
  └── company ACME SA de CV
```

Quien tenga una sola empresa no percibe el segundo nivel. Es el modelo de Odoo y
SAP, y `companies` ya existe con `company_id` poblado en las tablas raíz: la
Fase 0 dejó esto preparado a propósito.

### 3. ML: aislado por defecto, global por consentimiento explícito

Aquí es donde el aislamiento del plano transaccional **no** se traslada al
analítico. Ese es el punto que hace compatible "esquema por inquilino" con
"aprender de muchos".

```
  N esquemas aislados (OLTP)
        │
        │  extractor incremental por domain_events.id
        ▼
  ┌─────────────────────────────────────────────┐
  │  COMPUERTA DE CONSENTIMIENTO                │
  │  solo cruzan los inquilinos con opt-in      │
  └─────────────────────────────────────────────┘
        │
        ▼
  lakehouse compartido (parquet particionado por inquilino)
        │
        ▼
  Polars / DuckDB → features → entrenamiento
        ├── modelos por inquilino  (siempre, con datos propios)
        └── modelos globales       (solo con quienes aceptaron)
```

Reglas que no se negocian:

1. **Por defecto nada sale de su esquema.** `tenants.ml_contribution = false`.
2. **El consentimiento se guarda con fecha y responsable** (`ml_consent_at`,
   `ml_consent_by`) y es revocable. Al revocarse, los datos de ese inquilino
   salen del siguiente entrenamiento; los modelos ya entrenados se marcan para
   reentrenar.
3. **Un modelo global nunca se entrena con datos de quien no aceptó**, y eso se
   verifica en el pipeline, no por convención.
4. **Un modelo global sí sirve a todos**, hayan aportado o no. Ese es el trato:
   quien aporta mejora el modelo del que todos se benefician, y a cambio el
   cliente nuevo no arranca en frío.

**Por qué esto es la ventaja competitiva y no un adorno:** predecir la falla de
una bomba Waters QSM con la historia de un laboratorio es estadística pobre. Con
la de cincuenta, es un producto. Un ERP que llega con modelos ya entrenados el
día uno no compite contra otro ERP: compite contra la ausencia de alternativa.

### 4. Identidad global + membresías

```
users(id, email UNIQUE)                     ← la persona, única en la plataforma
memberships(user_id, tenant_id, role)       ← su rol en CADA inquilino

ana@lab.com
  ├── Evoelution  → agent
  └── ACME Labs   → admin
```

El rol **sale de `users` y pasa a `memberships`**. Es el cambio más invasivo de
la Fase 1: hoy `session.user.role` se consulta en 45 páginas y en cada acción, y
pasa a ser "el rol en el inquilino activo".

La sesión pasa a llevar `{ userId, activeTenantId, role, memberships[] }`, y un
selector arriba permite cambiar de inquilino.

---

## Plan por fases

Cada fase deja el sistema funcionando. No hay un "big bang" donde nada corre.

### Fase 1 — Plano de control y multi-inquilino  ✅ COMPLETA

Es el cimiento: sin esto, ninguna de las demás fases tiene dónde apoyarse.

| # | Entrega | Estado |
|---|---|---|
| 1.1 | Esquema `public`: tenants, companies, users, memberships, tenant_schemas | ✅ |
| 1.2 | Runner de migraciones por esquema (drizzle-kit no lo hace) | ✅ |
| 1.3 | Aprovisionamiento: crear inquilino = crear esquema + migrar + sembrar | ✅ |
| 1.4 | Contexto de inquilino (`tenantDb()`) y sesión con rol de plataforma | ✅ |
| 1.5 | Migrar los datos actuales a `tenant_evoelution` | ✅ |
| 1.6 | Rol desde membresías en las 45 páginas y las acciones | ✅ |
| 1.7 | Consola de plataforma: ver todas, entrar, dar de alta | ✅ |

**Criterio de terminado — verificado.** `probe-folios.mts` lo comprueba contra
la base real:

- Dos inquilinos con datos propios: `evoelution` (602 tickets) y `acme`.
- Folios sin colisión. La forma fuerte: el **mismo folio idéntico** puede existir
  en las dos empresas, porque el índice único de `tickets.reference` es de cada
  esquema. No es que los prefijos hagan que las cadenas difieran — con un
  `tenant_id` compartido habría que acordarse de meterlo en el índice; aquí no
  hay nada que recordar. Cada empresa cuenta desde su propia secuencia y emitir
  en una no mueve el contador de la otra.
- Una consulta de negocio sin inquilino activo **falla**: `select 1 from tickets`
  contra el plano de control da error porque la tabla no existe en `public`.

El folio lleva además el prefijo de la empresa (`EVO-000024`, `ACM-000001`), que
no estaba previsto cuando se escribió este criterio: el primer ticket de
cualquier otra empresa habría nacido marcado como de Evoelution.

### Consola de plataforma

La capa que está **por debajo** de los inquilinos: donde el equipo que opera el
SaaS ve todas las empresas y entra a cualquiera.

```
Astraion  (plataforma)            → consola: TODAS las empresas   /platform
└─ Evoelution  (un inquilino)     → su operación                  /dashboard
   ├─ sus tickets                                                 /tickets
   └─ sus clientes, equipos, contratos…                           /admin/*
```

Son **dos cáscaras distintas**, no dos secciones del mismo menú: `(console)`
tiene su propio layout con la marca de Astraion, y `(app)` es la aplicación de
una empresa con su barra lateral. Se veían iguales al principio —la consola
salía con el menú de Evoelution al lado— y eso hacía leer "administro la
plataforma" como una pestaña más de "administro mi empresa". Una persona puede
tener los dos sombreros a la vez (el superadministrador es además dueño de
Evoelution), así que la separación tiene que estar en la pantalla, no solo en
los permisos.

El recorrido es un ciclo cerrado: se inicia sesión y el personal de plataforma
aterriza en la **consola**, no dentro de una empresa. Desde ahí *Entrar* fija la
cookie y lleva al `/dashboard` de esa empresa; una franja permanente arriba
—`TenantBar`, en todas las páginas del portal, no solo en la consola— dice en
cuál estás y ofrece *Volver a Astraion*. Esa franja distingue "estás dentro de"
(sin membresía, en amarillo, con el acceso registrado) de "trabajando en" (tu
propia empresa). El momento peligroso no es mirar la lista de empresas: es
llevar veinte minutos leyendo tickets y haber olvidado de quién son.

`platform_role` en `users` es una dimensión **distinta** de `membershipRole`, no
un valor más de esa lista. El dueño de una cuenta manda en la suya y no debe ver
ninguna otra; un superadministrador ve todas. Mezclarlos en el mismo enum haría
que un error de comparación convirtiera a un cliente en operador de la
plataforma.

| Rol | Puede |
|---|---|
| `superadmin` | Dar de alta empresas, entrar a cualquiera, otorgar consentimiento de datos |
| `support` | Entrar a una empresa para diagnosticar; sin altas ni consentimientos |
| *(nulo)* | Nada de esto: es un usuario de un cliente |

**Entrar a la empresa de un cliente SIEMPRE deja registro** en `platform_events`,
con quién, cuándo y el motivo opcional. No es cortesía: un laboratorio
farmacéutico va a preguntar quién de tu equipo vio sus datos, y la respuesta no
puede depender de que alguien se acuerde. La UI marca el acceso con un aviso
visible para que nadie confunda "administro mi empresa" con "estoy dentro de la
de un cliente".

La cookie de empresa activa es **de sesión, no persistente**: entrar debe ser un
acto deliberado cada vez, no un estado que sobrevive semanas en el navegador.

### Cómo entra una empresa nueva

Un inquilino cuesta un esquema de Postgres con decenas de tablas. Crear uno por
cada formulario que alguien llena en la web dejaría la base sembrada de esquemas
vacíos, caros de listar, de migrar y de borrar. Por eso el alta tiene dos
tiempos:

1. **Solicitud** (`tenant_signups`, tabla del plano de control). La web pública
   la crea sin sesión. No hay usuario, ni esquema, ni acceso: es una fila con
   datos *declarados por un desconocido*. El correo de esa tabla no es una
   identidad — deliberadamente no es único, porque el historial de intentos de
   una misma persona es justo lo que hay que ver al revisarla.
2. **Aprobación** (superadministrador, en `/platform`). Ahí sí: se crea o
   reutiliza la cuenta del dueño, se aprovisiona el esquema, se aplican las
   migraciones y se registra la membresía `owner`.

El identificador que propone la web es una **sugerencia** derivada del nombre;
al aprobar se puede corregir, porque en ese momento se vuelve el nombre de un
esquema y cambiarlo después implica mover tablas con conexiones vivas. Todo el
formato se valida **antes** de crear la cuenta del dueño: el correo es único en
toda la plataforma, así que un dueño creado para un alta que después falla
quedaría ocupando ese correo sin membresía y sin poder entrar a ningún lado.

Al visitante se le responde **lo mismo** haya pasado lo que haya pasado —
solicitud nueva, correo repetido o trampa de robots. Decirle "ya existe una
solicitud con ese correo" convertiría el formulario público en un detector de
quién usa la plataforma.

Falta el envío de correo: hoy las credenciales del dueño se muestran **una vez**
en pantalla y el operador las entrega a mano.

### Fase 2 — Núcleo de ERP

Lo que hace que un ERP sea un ERP. Lo primero ya está:

**Cuentas por pagar ✅.** La deuda con un proveedor nace de su FACTURA
(`supplier_invoices`), no de la orden ni de la recepción: en la práctica no
coinciden —un proveedor factura dos órdenes juntas, o una orden llega en tres
remisiones— y es además el documento fiscal, con su folio y su UUID de CFDI.
Los pagos son un ledger append-only con el saldo en cada fila, mismo patrón que
`inventory_movements`: el saldo se construye, no se guarda en un campo que se
pueda desincronizar. Los controles que sostienen esto están en
`domain/payables.ts` y verificados en `probe-payables.mts`: el total tiene que
cuadrar con subtotal más impuestos, el mismo CFDI no entra dos veces (índice
único parcial), no se paga de más, y una factura con pagos no se cancela —eso
es una nota de crédito, no una desaparición—.

`settings` **por empresa** dejó de ser un pendiente: al mover las tablas de
negocio a un esquema por inquilino (paso 1.5), cada empresa tiene su propia
fila. El bug latente se cerró solo.

Lo que sigue faltando:

- Documentos con máquina de estados: cotización → pedido → factura → pago,
  inmutables una vez emitidos
- Ledger contable de doble entrada (el inventario ya sigue este patrón, sirve de modelo)
- **CFDI 4.0 / timbrado SAT**: requisito legal, no funcionalidad. Series de
  folios por empresa, cancelaciones con acuse, complementos de pago
- Moneda: migrar el par `mxn`/`usd` a `(importe, moneda, tipo_de_cambio, fecha)`

### Fase 3 — Plano analítico

- Extractor incremental de `domain_events` por `id` (por eso es `bigserial` y no uuid)
- Compuerta de consentimiento
- Lakehouse en parquet particionado por inquilino
- **Aquí Iceberg empieza a ganarse el lugar**: time-travel para reproducir un
  entrenamiento, evolución de esquema entre inquilinos, particionado
- Polars para features (no para el código de cromatografía de `evo_ai`, que es
  numérico y donde pandas no estorba)

### Fase 4 — Laboratorio de ML

El producto visible. Sin las fases anteriores sería una demo.

- **Registro de modelos**: versión, algoritmo, métricas, alcance (inquilino/global), estado
- **Servicio**: predicciones **persistidas** en `ml_predictions`, nunca en línea
  bloqueando un render
- **Retroalimentación**: `ml_outcomes` con el resultado real. Es lo que casi todo
  producto con ML omite, y sin eso no se puede medir si el modelo se degrada
- **Deriva y reentrenamiento** con disparadores
- **UI del laboratorio**: un usuario avanzado ve sus datasets, entrena desde
  plantillas sin escribir código, compara métricas, promueve a producción

Casos de uso que el dato ya soporta:

| Modelo | Alimentado por |
|---|---|
| Riesgo de incumplir SLA | tickets + `domain_events` |
| Tiempo de resolución estimado | historia de bitácoras y horas |
| Demanda de refacciones y punto de reorden | `inventory_movements` |
| Propensión a cierre de un negocio | eventos de etapa del CRM |
| Riesgo de no renovación de contrato | contratos + actividad de tickets |
| Anomalías de cromatografía | `evo_ai` (ya entrenado) |

---

## Reglas para escribir código en esta arquitectura

Estas reglas se suman a las de [ARQUITECTURA.md](./ARQUITECTURA.md), que siguen
vigentes (transacciones, folios por secuencia, ledger, eventos).

### Toda lectura y escritura de negocio pasa por `tenantDb()`

```ts
export async function getTickets() {
  const db = await tenantDb();          // ← nunca getDb()
  return db.query.tickets.findMany();
}
```

`tenantDb()` devuelve un cliente cuyo `search_path` es `tenant_x, public`, fijado
al abrir la conexión. Consecuencias prácticas:

- Las consultas que además tocan `users` o `companies` siguen funcionando: esas
  tablas están en `public`, que es el segundo elemento del `search_path`.
- Si no hay empresa activa, `tenantDb()` lanza. Que falle es la red de seguridad
  — no la desactives calificando el esquema a mano.

**Se eligió un pool por esquema sobre `SET LOCAL` dentro de una transacción**
para que las ~115 consultas ya escritas conservaran su forma en vez de
reescribirse como callbacks. El aislamiento es igual de estricto: el esquema
viaja en la conexión, no en un ajuste que se pueda olvidar.

El costo es el número de conexiones: cada empresa activa mantiene su pool. Por
eso `DB_TENANT_POOL_MAX` es bajo (3) y `DB_TENANT_IDLE` corto (20 s) — una
empresa inactiva devuelve sus conexiones. **Con decenas de empresas concurrentes
esto deja de alcanzar**, y ese es el punto donde se pasa a un pooler externo o al
modelo por transacción. Está medido, no es una sorpresa esperando.

### El plano de control se consulta con `getDb()`

`tenants`, `users`, `memberships` viven en `public` y **no** llevan inquilino
activo: son justamente lo que se consulta para saber cuál es.

### El rol es del inquilino, no de la persona

```ts
// ✗ ya no existe: la columna `users.role` se eliminó en 1.6
session.user.role
// ✓
const role = await currentRole();         // rol en el inquilino ACTIVO, o null
if (!isAdminRole(role)) notFound();
```

`currentRole()` devuelve `null` cuando no hay empresa activa, y los helpers de
`roles.ts` lo tratan como "no puede": el camino de menos resistencia es el
seguro. `owner` cuenta como administrador en todos ellos salvo en `isOwner()`,
que reserva facturación y consentimiento de datos para quien firma.

La sesión sigue diciendo **quién** es la persona (`id`, `email`, `platformRole`).
Qué puede hacer depende de dónde está parada.

### `users` es la única tabla compartida, y por eso se consulta filtrada

`users` vive en `public` a propósito: una identidad, muchas membresías. El
precio es que es el único sitio donde el aislamiento **no** lo da el esquema —
un `select * from users` desde el esquema de un inquilino devuelve el padrón de
toda la plataforma sin fallar ni avisar.

Por eso ninguna consulta de negocio toca `users` directamente:

```ts
// ✗ devuelve gente de otras empresas
db.select().from(users).where(eq(users.role, "client"))
// ✓ arranca de memberships: no hay forma de olvidarse del filtro
listTenantMembers({ roles: ["client"] })
```

`data/people.ts` es el único módulo que hace ese join, y expone además las
variantes `*For(tenantId, …)` para lo que corre fuera de una petición — mismo
par que `tenantDb()` / `tenantDbFor()`.

Ojo con las dos banderas de "activo", que significan cosas distintas:
`users.active` es la cuenta en toda la plataforma (la apaga la plataforma, no un
cliente) y `memberships.active` es la pertenencia a **una** empresa. Confundirlas
deja fuera a un consultor de sus otros tres clientes.

### Nada de tablas de negocio en `public`

Si una tabla de negocio existiera en `public`, una consulta sin inquilino la
encontraría y devolvería datos equivocados en silencio. La ausencia es lo que
convierte el olvido en un error visible.

Esto **también gobierna las migraciones**, y ahí se coló una vez:

| Configuración | Genera en | Qué gobierna |
|---|---|---|
| `drizzle.config.ts` | `drizzle/` | Plano de control: `platform.ts` y nada más |
| `drizzle.tenant.config.ts` | `drizzle-tenant/` | Tablas de negocio, replicadas en cada esquema |

Hasta el paso 1.5 la primera incluía también `schema.ts`, porque las tablas de
negocio vivían en `public`. Cuando se movieron, la configuración quedó
desfasada: el generador seguía creyendo que estaban ahí y propuso **recrearlas
en `public`** — 40 sentencias que habrían desarmado el aislamiento sin que nadie
lo notara al revisar el diff, porque el archivo se llamaba "eliminar users.role".

Los enums de negocio sí viven en `public`, y es deliberado: las migraciones de
inquilino los crean calificados (`CREATE TYPE "public"."ticket_status"`) para
compartir un solo tipo entre todos los esquemas. Los gobierna `drizzle-tenant/`.
`drizzle/` no debe verlos ni intentar borrarlos.

---

## Riesgos y cómo se controlan

| Riesgo | Control |
|---|---|
| Consulta sin inquilino activo | Falla cerrado: la tabla no existe en `public` |
| Padrón de personas cruzando empresas | `users` solo se consulta por `data/people.ts`, que arranca del join con `memberships` |
| Migración aplicada a medias entre esquemas | Runner transaccional por esquema + registro de versión por esquema |
| Fuga entre inquilinos | Sin `tenant_id` que filtrar mal: el aislamiento es físico |
| Dato de un inquilino sin consentimiento en un modelo global | Compuerta verificada en el pipeline, con prueba automatizada |
| Muchos esquemas degradando el planner | Techo conocido; se cruza moviendo inquilinos grandes a otra base |
| Una migración recreando tablas de negocio en `public` | `drizzle/` solo mira `platform.ts`; el diff de negocio sale por `drizzle-tenant/` |
| Conexiones agotadas | `search_path` por transacción, no por conexión: el pool se comparte |

---

## Lo que este documento todavía no resuelve

Dicho explícitamente para que no parezca cubierto:

- **Facturación del SaaS**: planes, límites, medición de uso
- **Onboarding**: alta autoservicio o asistida
- **Respaldos por inquilino**: `pg_dump -n tenant_x`, retención, restauración selectiva
- **Región de datos**: si un cliente exige que sus datos no salgan de México
- **Migración de un inquilino a base dedicada** cuando crezca
- **Pruebas**: el repo sigue sin una suite. Lo que hay son *probes* que se
  corren a mano contra la base de desarrollo y limpian lo que crean:
  `probe-e2e.mts` (recepción de compras), `probe-roles.mts` (rol por membresía y
  aislamiento del padrón) y `probe-folios.mts` (criterio de la Fase 1). Sirven
  para verificar un cambio concreto, no para que nadie los rompa sin enterarse:
  no corren solos ni en CI. Antes de tocar dinero e inventario multi-inquilino,
  eso importa más que cualquier funcionalidad de esta lista
