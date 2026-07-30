# Arquitectura — camino a ERP + ML

Este documento describe hacia dónde va la plataforma y, sobre todo, **las reglas
que hay que respetar al escribir código nuevo** para no volver a pagar la deuda
que la Fase 0 acaba de cerrar.

---

## Los dos planos

```
┌─── Plano transaccional (fuente de verdad) ──────────────────┐
│  Next.js  →  src/lib/domain/*  (lógica pura, testeable)      │
│              ↓                                               │
│           Postgres  +  domain_events (append-only)           │
└──────────────────────────┬───────────────────────────────────┘
                           │ CDC / batch nocturno
┌──────────────────────────▼─── Plano analítico / ML ─────────┐
│  parquet en object storage  →  Polars / DuckDB (features)    │
│         (→ Iceberg cuando se cumpla un disparador)           │
│              ↓                                               │
│  FastAPI :8000 (evo_ai)  →  tabla ml_predictions en Postgres │
└──────────────────────────────────────────────────────────────┘
```

Dos reglas que sostienen el diseño:

1. **Next.js nunca importa Python; llama HTTP.** Las predicciones **se
   persisten** en Postgres. La UI lee de la tabla, no bloquea un render
   esperando al modelo. Como efecto secundario queda el histórico de
   predicciones, que es lo que permite medir drift.
2. **El entrenamiento nunca lee las tablas OLTP.** Lee del plano analítico. Si
   no, cada reentrenamiento compite con los usuarios por la misma base.

---

## Reglas al escribir código (Fase 0 en vigor)

### 1. Toda escritura multi-tabla va en una transacción

```ts
await db.transaction(async (tx) => {
  const [row] = await tx.insert(algo).values({...}).returning({ id: algo.id });
  await recordEvent(tx, { ... });   // el mismo tx, siempre
});
```

Dos excepciones deliberadas, ambas documentadas en el código:

- **`redirect()` y `notFound()` van FUERA de la transacción.** Lanzan
  `NEXT_REDIRECT` como control de flujo; dentro del bloque harían rollback de
  todo lo que se acaba de escribir. Es el error clásico al combinar Server
  Actions con transacciones.
- **Los efectos secundarios que pueden fallar sin invalidar la operación**
  (p. ej. `runStageAutomations`) van fuera. Si fallaran dentro, Postgres
  abortaría la transacción entera y se perdería el negocio por no haber podido
  crear una tarea de recordatorio.

### 2. Los folios salen de una secuencia, nunca de `count(*)`

```ts
reference: await nextTicketReference(tx)   // src/lib/domain/references.ts
```

`count(*) + 1` reutilizaba números al borrar filas y colisionaba entre
inserciones concurrentes. Medido: **20 de 25 inserciones simultáneas fallaban**
con violación de unique; con secuencia, 0 de 25.

A cambio, la secuencia puede dejar **huecos** si una transacción aborta. Un
hueco es aceptable; un folio duplicado no. Cuando llegue facturación con
series fiscales, revisar este punto: el SAT sí observa la continuidad.

### 3. `spare_parts.stock` es caché, no la verdad

La verdad es `inventory_movements`. Nunca hacer `UPDATE spare_parts SET stock`.

```ts
await consumePart(tx, { partId, quantity, ticketCommentId, actorId });
await applyInventoryMovement(tx, { partId, kind: "adjustment", quantity: delta });
```

`applyInventoryMovement` toma un lock de fila (`for update`) antes de calcular
el saldo: sin él, dos técnicos registrando consumo de la misma pieza a la vez
escriben balances contradictorios. Verificado con 20 consumos concurrentes.

**El stock puede quedar negativo, a propósito.** Antes se topaba con
`greatest(0, stock - qty)`, lo que silenciaba el faltante: pedías 5, había 2,
quedaba 0 y las 3 piezas faltantes desaparecían del sistema. Ahora el consumo
real se registra tal cual, el saldo queda en −3 y el panel de refacciones lo
muestra como sobregiro para que compras reaccione.

### 4. Índices: Postgres no indexa las foreign keys

Hasta la migración `0013` **ninguna tabla de negocio tenía un solo índice** más
allá de la primary key y los `unique`. Es un malentendido común: declarar una
foreign key **no** crea índice sobre la columna que referencia. `crm_deals`
tenía 7 FKs y 0 índices; `tickets`, 6 y 0.

Medido con 100 000 negocios, 50 000 tickets y 200 000 comentarios:

| Consulta | Sin índices | Con índices | Ganancia |
|---|---|---|---|
| Bitácora de un ticket | 7.05 ms | 0.056 ms | **126x** |
| "Mis tickets" de un cliente | 4.47 ms | 0.082 ms | **54x** |
| Embudo por etapa y vendedor | 13.2 ms | 3.2 ms | 4.1x |
| Negocios estancados | 15.5 ms | 2.7 ms | 5.7x |
| Cerrados por mes (12 meses) | 18.6 ms | 14.9 ms | 1.2x |

La lectura importante está en la asimetría, no en el promedio:

- **Las búsquedas selectivas ganan dos órdenes de magnitud.** Son las que
  dominan cada carga de página del portal.
- **Las consultas de agregación casi no mejoran.** "Sumá todo el pipeline de los
  últimos 12 meses" tiene que tocar un tercio de la tabla; ningún índice evita
  ese trabajo.

De ahí se sigue una conclusión de arquitectura, con evidencia: **los informes no
se arreglan con índices, se arreglan sacándolos del OLTP.** Es el argumento real
para el plano analítico (parquet + Polars/DuckDB), y el punto donde
efectivamente empieza a tener sentido evaluar Iceberg.

Al agregar un índice nuevo, verificar con `EXPLAIN (ANALYZE)` que el planner lo
usa: un índice que nadie elige solo cuesta en cada escritura.

### 5. Todo cambio de negocio emite un evento

```ts
await recordEvent(tx, {
  aggregateType: "deal",
  aggregateId: deal.id,
  eventType: "deal.created",   // union cerrado: un typo no compila
  actorId: session.user.id,
  payload: { ... },
});
```

`domain_events` cumple dos necesidades con un solo registro: la auditoría que
exige un ERP, y la historia que necesita ML. Las tablas de negocio guardan
estado **mutable**, así que sin esta bitácora cada `UPDATE` borra el pasado y no
hay features "as-of" que entrenar (¿en qué etapa estaba este negocio hace 30
días?). Ningún modelo de propensión a cierre es entrenable sin esto.

Es **append-only y se hace cumplir en la base**, no por convención: un trigger
rechaza `UPDATE` y `DELETE`. Una bitácora de auditoría que la aplicación puede
reescribir no sirve como evidencia. Si algún día hay que purgar por retención,
se quita el trigger deliberadamente en una migración propia:

```sql
DROP TRIGGER domain_events_no_update_delete ON domain_events;
-- … purga …
CREATE TRIGGER domain_events_no_update_delete
  BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION domain_events_append_only();
```

`crm_deal_events` sigue existiendo: es una **proyección** específica del CRM que
alimenta la línea de tiempo del negocio en la UI. No la reemplaza.

### 6. Los borrados emiten evento con snapshot

Los borrados de la app son **duros y en cascada**. Una vez ejecutados, el evento
es la única copia que queda de lo que había, así que se guarda el registro
completo:

```ts
await db.transaction(async (tx) => {
  const [row] = await tx.delete(crmDeals).where(eq(crmDeals.id, id)).returning();
  if (!row) return;
  await recordDeletion(tx, {
    aggregateType: "deal", aggregateId: id, eventType: "deal.deleted",
    actorId: session.user.id, snapshot: row,   // ← la fila entera
  });
});
```

`recordDeletion` se llama **después** del delete y con el resultado de su
`.returning()`: así el snapshot es exactamente lo que se borró y no cuesta un
`SELECT` extra. Cuando la cascada se lleva otras filas, se agrega contexto en
`extra` (p. ej. `deleteContract` guarda los `equipmentIds` que amparaba).

Están cubiertas las 16 rutas de baja. Las dos excepciones deliberadas son los
`delete` de `contract_equipment` dentro de `updateContract` y
`toggleContractEquipment`: son un *re-vínculo* de equipos, no la baja de un
registro, y el estado resultante queda en el contrato.

Al agregar un `delete` nuevo: envolver en transacción, usar `.returning()` y
emitir el evento. Un borrado sin evento es un agujero en la auditoría — que es
justamente lo que un ERP tiene que poder responder.

---

## Infraestructura

El detalle operativo está en [DEPLOY.md](./DEPLOY.md). Lo que importa desde la
arquitectura:

**Un VPS con Docker Compose, no serverless.** No es preferencia: el portal hace
**varias consultas por render**, y con la app y Postgres en la misma máquina
cada una cuesta ~0.3 ms contra los 15–30 ms de una base remota. Para SSR, la
localidad domina. Además el filesystem de Vercel es de solo lectura y efímero,
lo que rompe las fotos de equipos, y en serverless cada instancia abre su
propio pool: haría falta un pooler en modo *transaction* (en modo *statement*
las transacciones de la Fase 0 no funcionan).

**Los uploads salieron de `public/`.** Antes se escribían dentro del proyecto,
que se reconstruye en cada imagen: las fotos desaparecían en el siguiente
deploy. Ahora van a `UPLOADS_DIR` (un volumen), y **las sirve nginx**
directamente — no tiene sentido despertar a Node para devolver un JPG.
`saveImage()` conserva la firma a propósito: migrar a S3/R2 el día que haga
falta escalar horizontalmente es reemplazar el cuerpo de esa función, sin tocar
a ninguno de sus llamadores.

**Las migraciones son un paso del deploy, no algo manual.** El servicio
`migrate` corre antes que `web`, y `web` solo arranca si terminó bien. Nunca
queda una versión de la app contra un schema viejo.

Dos cosas que se corrigieron de paso, ambas de seguridad:

- `images.remotePatterns` era `hostname: "**"`, o sea cualquier host HTTPS: en
  producción eso es un proxy de imágenes abierto, y lo paga tu servidor. Ahora
  la lista sale de `NEXT_PUBLIC_IMAGE_HOSTS` y está vacía, que es lo correcto
  hoy (no hay una sola imagen remota en el código ni en la base).
- nginx corta con 444 los hosts desconocidos: sin eso, cualquiera que apunte su
  dominio a la IP sirve el sitio bajo su nombre.

### `middleware.ts` → `proxy.ts`

Hecho. La convención `middleware` quedó deprecada en Next 16 y el archivo pasó
a `src/proxy.ts` — mismo contrato (`export default` + `config.matcher`).

Una advertencia que costó encontrar: **no pueden coexistir los dos archivos.**
Con `middleware.ts` y `proxy.ts` a la vez, el build pasa sin quejarse pero en
producción TODAS las rutas entran en bucle de redirección (`/` → `/` con 307).
En `next dev` no se nota. Si alguna vez el sitio queda en bucle tras tocar
enrutado, eso es lo primero que hay que mirar.

Dato útil para no confundirse: con `proxy.ts`, `middleware-manifest.json` queda
vacío y es **normal** — Next 16 registra el proxy por otra vía. Un manifest
vacío no significa que el proxy no esté corriendo.

## Deuda conocida, ordenada

### Baja lógica (`deleted_at`) — pendiente

Los borrados **ya se registran**: las 16 rutas de baja emiten `*.deleted` con el
registro completo en el payload (ver regla 6). Lo que falta es el paso
siguiente: los borrados siguen siendo **duros y en cascada** — eliminar una
etapa borra sus negocios; eliminar un negocio borra sus actividades, notas y
líneas. El evento conserva el agregado borrado, pero no lo que se llevó la
cascada.

Para un ERP lo correcto es baja lógica (`deleted_at`) en los agregados con
historia — `crm_deals`, `contracts`, `crm_organizations` — de modo que el
registro siga existiendo y consultable, marcado como dado de baja. Eso sí cambia
comportamiento visible (todas las lecturas necesitan filtrar), así que es
trabajo de Fase 2 y no de un parche.


### Moneda (Fase 2)

Hoy los importes son **columnas paralelas** — `valueMxn`/`valueUsd`,
`costMxn`/`costUsd`, ~20 pares en el schema. Agregar EUR es una migración en 10
tablas, y sin tipo de cambio histórico la utilidad de un contrato de 2024 se
recalcula con el dólar de hoy: el número cambia solo.

La Fase 0 dejó preparado el destino sin romper nada: `currency`, `fx_rate`,
`fx_date` en `crm_deals` y `contracts`, más la tabla `fx_rates`. **Ningún lector
los usa todavía.** La migración del modelo dual es trabajo de Fase 2, porque sí
cambia comportamiento visible.

### Documentos y contabilidad (Fase 2)

Falta lo que hace que un ERP sea un ERP: documentos con máquina de estados
(cotización → pedido → factura → pago), inmutables después de emitidos, y
ledger de doble entrada. El inventario ya sigue este patrón; sirve de modelo.

**CFDI 4.0 / timbrado SAT no es un feature, es requisito legal** — la operación
es en MXN y en México. Condiciona el diseño de facturación desde el día uno:
series de folios, cancelaciones con acuse, complementos de pago. Decidirlo
antes de escribir la primera tabla de facturas, no después.

### Multi-empresa

`companies` existe y las tablas raíz (`tickets`, `crm_deals`,
`crm_organizations`, `contracts`, `spare_parts`) ya tienen `company_id`
poblado con la empresa por defecto. Falta el **filtrado por empresa** en la capa
`src/lib/data/*` y en la sesión. Se agregó ahora, con 37 tablas en el schema,
justamente para no tener que re-migrar con 80.

### Sin tests

No hay un solo test en el repo. Antes de tocar facturación e inventario en
serio, eso importa: la verificación de la Fase 0 se hizo con un script
desechable contra una base temporal, no con una suite que corra en CI.

### Bugs menores detectados, no corregidos

`updatePart` (`src/lib/actions/parts.ts`) parsea `priceMxn`/`priceUsd` del
formulario pero **no los escribe** en el `UPDATE`: editar el precio de venta de
una refacción no tiene efecto. Está fuera del alcance de la Fase 0; se dejó
señalado a propósito en vez de arreglarlo de contrabando.

`saveImage` sanea el subdirectorio quitando los caracteres no permitidos, así
que `../../etc` queda en `//etc`: **no escapa** del directorio base (el
comportamiento es seguro), pero genera rutas con barras dobles. Conviene
normalizar cuando se toque ese archivo.

---

## Iceberg y Polars — cuándo sí

**Polars: ya.** Es la herramienta correcta del lado Python (`evo_ai`) para
feature engineering sobre los parquet que ya se generan y sobre extractos de
Postgres.

**Iceberg: todavía no.** Iceberg resuelve escala y evolución de esquema en un
lake. El problema hoy no es escala — es que hasta la Fase 0 **no había historia
que consultar**. Adoptarlo ahora da time-travel sobre tablas sin pasado:
catálogo, compaction y un motor tipo Trino/DuckDB de costo operativo, sin el
dato que lo justifique.

Mientras tanto: **Postgres como fuente de verdad + parquet particionado +
DuckDB/Polars**. Migrar parquet → Iceberg después es directo.

Disparadores para adoptarlo (condiciones, no fechas):

- Los parquet sueltos duelen: evolución de esquema, escrituras concurrentes,
  particionado manual.
- Se necesita **reproducibilidad de entrenamiento**: "reentrenar exactamente con
  el snapshot del 1 de marzo". Aquí el time-travel de Iceberg es genuinamente la
  killer feature para ML, no un lujo.
- Conviven varias fuentes: transaccional ERP + series de cromatografía +
  telemetría de equipos.

---

## Integración con evo_ai (pendiente)

`ML_SERVICE_URL` está declarada en `.env.local` y en `.env.example` apuntando a
`http://localhost:8000` — que es exactamente donde corre el FastAPI de `evo_ai`
— **y no se usa en ninguna parte del código**. `grep -rn "fetch(" src` no
devuelve nada. Los dos sistemas todavía no se hablan.

`tickets.ml_suggested` (jsonb) ya anticipa predicciones inline. Sirve para
mostrar la sugerencia vigente, pero al ser un campo mutable pierde el histórico:
la tabla `ml_predictions` del diagrama es la que permite medir si el modelo está
mejorando o degradándose.
