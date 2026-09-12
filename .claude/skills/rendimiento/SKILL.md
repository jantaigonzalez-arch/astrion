---
name: rendimiento
description: Revisar el rendimiento del repo — consultas lentas, N+1, índices que faltan, paginación que no escala y bultos de cliente. Úsalo antes de desplegar algo que toque listados o consultas, cuando una pantalla "se siente lenta", al añadir una tabla o una consulta nueva, o para la revisión periódica. Mide contra la base sembrada, nunca contra la copia de producción.
---

# Rendimiento

## La regla que ordena todo lo demás

**No se optimiza lo que no se ha medido, y no se mide contra datos pequeños.**

Producción tiene hoy 634 tickets. La base sembrada tiene 14 151. Una consulta
que tarda 2 ms sobre lo pequeño y 900 ms sobre lo grande se ve idéntica en las
dos si solo miras la pantalla — y la que se rompe es la de dentro de dos años,
cuando ya nadie recuerda por qué se escribió así.

Así que **todo lo de aquí corre contra `evoelution_ci`**, que `npm run
pruebas:base` siembra con diez años de historia. Nunca contra la copia de
producción: es lenta de medir porque es pequeña, y además tiene clientes reales.

## Cómo se corre

```bash
npm run pruebas:base          # una vez; 14 151 tickets, 19 073 comentarios

DATABASE_URL="postgresql://…/evoelution_ci" PROBE_SCHEMA=tenant_evoelution \
  npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
  scripts/_probe-rendimiento.ts     # milisegundos por consulta

DATABASE_URL="postgresql://…/evoelution_ci" PROBE_SCHEMA=tenant_evoelution \
  npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
  scripts/_probe-perf.ts            # CONSULTAS por pantalla
```

Los dos arrancan en un clon limpio. Durante meses no fue así:
`_probe-rendimiento.ts` estaba versionado pero `tsconfig.probe.json` y los
stubs de `scripts/_stub-*` no, o sea que este skill apuntaba a algo que no se
podía correr. Los stubs entraron al repositorio con una guardia que los mata si
se cargan dentro de Next (`scripts/_stub-guardia.ts`), y con eso se cerró.

`_probe-perf.ts` sigue fuera a propósito: mide contra el volumen REAL y vive en
`SOLO_LOCAL`. Si no lo tenés, es que no sincronizaste producción.

`--tsconfig` va **antes** de `--conditions`. Al revés, tsx le pasa el primero a
node y node contesta «bad option: --tsconfig» sin decir de quién es la culpa.
Ha costado encontrarlo tres veces: la tercera, porque este mismo párrafo lo
decía al revés (corregido el 2026-09-12, comprobado con `node` 24).

Los dos probes contestan preguntas distintas y hacen falta los dos: una pantalla
puede hacer **dos** consultas y tardar 400 ms, o **cuarenta** y tardar 12.

## Las cinco cosas que buscar, en orden de lo que más ha dolido aquí

### 1 · Llaves foráneas sin índice

El hallazgo con mejor relación coste/beneficio de este repositorio. Postgres
**no** indexa una FK por ti, y sin índice cada borrado o actualización del padre
recorre la tabla hija entera para validar la restricción.

Medido: borrar **un** módulo de equipo tardaba **25,6 ms** porque validaba
`tickets` (14 151) y `ticket_comments` (19 073) a pulso. Con los cuatro índices
puestos, **3,8 ms** — 6,7×.

```sql
select c.conrelid::regclass::text||'.'||a.attname, s.n_live_tup
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  join pg_stat_user_tables s on s.relid=c.conrelid
 where c.contype='f' and c.connamespace='tenant_evoelution'::regnamespace
   and s.n_live_tup > 500
   and not exists (select 1 from pg_index i
                    where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1])
 order by s.n_live_tup desc;
```

**No las indexes todas.** Un índice se paga en cada `INSERT` y en cada `UPDATE`.
Indexa las que estén en tablas grandes **y** cuyo padre se borre o se consulte
por ahí. La 0027 de inquilino existe precisamente porque se había creado un
índice que nadie usaba.

### 2 · Paginación por OFFSET

`OFFSET 10000` no salta diez mil filas: **las lee y las tira**. Medido en la
cola de tickets, página 400: 113 ms leyendo 10 025 filas para devolver 25, y
crece linealmente.

Solo duele en listados que crecen sin techo (tickets, archivo de viáticos,
cuentas por pagar). Cuando duela, la salida es **paginación por cursor**: en vez
de `offset`, un `where (created_at, id) < (…)` con el índice que ya ordena. Con
`limit` y sin `offset` el problema no existe.

Y comprueba lo básico primero: que el índice sirva al `ORDER BY` completo,
**incluido el desempate**. Ver la migración `0027_indice_viaticos`, que midió
6,34 ms → 0,30 ms solo por poner el orden correcto en el índice.

### 3 · N+1 y consultas dentro de bucles

```bash
grep -rn "for (.*of\|\.map(" src/lib/data src/app --include="*.tsx" -A 4 \
  | grep -B 2 "await.*\(db\|tenantDb\|select\)"
```

El patrón de este repo para arreglarlo es **una consulta con `inArray` y un
`Map`**, no un `Promise.all` de N consultas. Ejemplo escrito: `modulosPorContrato`
pasó de 55 consultas a 2 y de 29,6 ms a 6,5.

Ojo con el falso arreglo: `Promise.all` de 55 consultas sigue siendo 55 viajes;
solo los hace a la vez, y con dos conexiones por empresa eso es una cola.

### 4 · Consultas sin tope

```bash
grep -rn "export async function" src/lib/data/*.ts -A 20 \
  | grep -B 20 "\.from(" | grep -L "limit"
```

Una consulta sin `limit` sobre una tabla que crece es una bomba de relojería con
la mecha en la fecha de adopción del cliente. Sobre **tablas de dimensión**
—miembros, rubros, etapas del embudo— está bien y ponerle tope sería peor.

La pregunta no es «¿tiene `limit`?» sino **«¿qué la acota?»**. Si la respuesta
es «que hoy hay pocos», es un hallazgo.

**Pasó con el catálogo de refacciones, y no se vio hasta el día de la carga.**
Con una refacción, cinco pantallas cargaban el catálogo ENTERO —el inventario,
el buscador de la bitácora del ticket, la orden de compra nueva, la requisición
y el negocio del CRM— y ninguna lo notaba. Al cargar el reporte del ERP anterior
(6 609 refacciones), medido en local antes de tocar nada:

```
                         antes              después
inventario               10 MB   1,4 s  →  210 KB  0,24 s   (página de 25, en el servidor)
detalle de ticket        1,2 MB  4,0 s  →  121 KB  0,11 s   (el buscador pregunta al teclear)
orden de compra nueva    1,2 MB         →   87 KB
búsqueda de refacción    —              →  ~10 ms en la base, 20 resultados
```

Lo que quedó como regla: **una lista que la gente elige no viaja entera con la
página si puede crecer**. Se busca en el servidor —`Selector` con `buscar`,
`PartsPicker`, la acción `buscarRefaccionesAccion`— con tope de resultados.
`probe-inventario.mts` comprueba que solo la exportación pida el catálogo
completo. Antes de cargar datos masivos, busca quién hace `select` sin `where`
sobre la tabla que vas a llenar: es la lista de pantallas que se van a caer.

### 5 · Memoización por petición

React `cache()` memoiza **por petición**. Lo que lo aprovecha —`dashboardStates`,
la marca del inquilino— se lee una vez aunque tres componentes lo pidan.

Para medirlo hace falta simular la petición: fuera de una no hay dispatcher de
caché y cada llamada vuelve a leer, así que medir a secas da el número de ANTES.
`scripts/_probe-perf.ts` ya monta ese ámbito; léelo antes de escribir uno nuevo.

`unstable_cache` es otra cosa: cachea **entre** peticiones y hay que invalidarlo
a mano. Si lo usas, invalídalo en la acción que escribe —`updateTag`— o el
usuario guardará y seguirá viendo lo viejo durante una hora. Pasó con el logo
del membrete y el síntoma fue «no se guarda», que manda a buscar al sitio
equivocado.

## Cómo se escribe el arreglo

Este repositorio **exige la medición en el comentario de la migración**, no solo
el cambio. Mira `0027_indice_viaticos`: dice el antes, el después, el volumen
contra el que se midió y por qué el índice viejo no servía. Un índice sin esa
nota es un índice que nadie se atreverá a borrar dentro de un año.

```
-- ── MEDIDO ────────────────────────────────────────────────
--   borrar un módulo, sin índices     25,6 ms
--   borrar un módulo, con ellos        3,8 ms
-- Contra `evoelution_ci`: 14 151 tickets y 19 073 comentarios.
```

Y las migraciones **se escriben a mano en las dos carpetas** — `drizzle/` y
`drizzle-tenant/`. Ver la regla 4 de `AGENTS.md`: `drizzle-kit generate` compara
contra un snapshot de hace seis migraciones y produce una que las rehace todas.

### 6 · Una subconsulta por fila donde hay `OFFSET`, y un `OR` que apaga los índices

Los dos los trajo la 0037 (viáticos a varios destinos) y los cazó la medición
contra volumen, no la lectura del código:

- **Una subconsulta correlacionada en el `select` se evalúa también para las
  filas que el `OFFSET` tira.** El listado de viáticos armaba los destinos de cada
  fila con un `json_agg` en la lista del `select`: la página 80 del archivo pasó
  de 11,7 a 35,3 ms. La salida es traer primero la página y después, en UNA
  consulta con `inArray`, lo de esas filas (`destinosPorViatico`): 8,6 ms.
- **Un `OR` entre dos caminos dentro de un `EXISTS` no usa índices**: cruza las
  dos tablas. `TIENE_CONTRATO_VIGENTE` tardaba 4-5 ms con 88 organizaciones y
  crecía como organizaciones × contratos; partido en dos `EXISTS`, 0,3 ms.

**Y la trampa del instrumento:** con el stub de inquilino viejo (`tenantId` de
ceros) «miembros del inquilino» se medía devolviendo **0 filas**, y organizaciones
y la cola de tickets salían más rápidas de lo que son. Antes de comparar dos
números, comparar cuántas filas devolvió cada uno.

Para una comparación antes/después de verdad: `git worktree` en el commit de
antes, su propia base (`DATABASE_URL=…/evoelution_antes_ci bash
scripts/base-de-pruebas.sh`), la MISMA carga de volumen en las dos, y el mismo
script midiendo mediana de 15 corridas. El informe de `_probe-rendimiento` mide
una corrida por consulta: sirve para ver el orden de magnitud, no para decidir
por un milisegundo.

## Lo que NO es un problema de rendimiento

- **Un `count(*)` para el paginador.** 1 ms sobre 14 151 filas. Está medido.
- **Las subconsultas correlacionadas de los listados.** Se eligieron por encima
  de `left join` + `group by` a propósito: con el join, cada fila se repite una
  vez por hija y los importes se cuentan de más. Correcto antes que rápido.
- **Los tiempos de un solo dígito.** Si algo tarda 4 ms, no es ahí donde está el
  problema del usuario. Busca el viaje de red, la cascada de peticiones o el
  bulto de JavaScript antes de tocar esa consulta.

## Antes de dar por buena una mejora

1. Vuelve a correr los dos probes y **pega el antes y el después**.
2. `npm run test:todo` — 26 pruebas. Una consulta más rápida que devuelve otra
   cosa no es una mejora.
3. Si tocaste el esquema, ensáyalo contra la copia local (regla 4 de AGENTS.md).
4. Di también lo que **no** mejoró. Una revisión donde todo sale bien casi
   siempre es una revisión que midió lo fácil.
