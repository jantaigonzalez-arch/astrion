---
name: modelo-de-datos
description: Añadir o cambiar tablas, columnas, índices o migraciones en este repositorio — dónde vive cada tabla (inquilino o plataforma), cuándo partir una entidad en 1:1, qué NO se guarda porque es derivado, qué unicidad refleja el negocio, y cómo se comprueba que el modelo aguanta. Úsalo ANTES de escribir una migración o de añadir una columna, y cuando alguien pregunte si el esquema está normalizado o si va a escalar.
---

# Modelo de datos

## La regla que ordena todo lo demás

**Una columna es una promesa de que alguien va a mantener ese dato al día.**

Casi todos los errores de modelado de este repositorio son la misma cosa: una
columna que parecía útil, que nadie alimentó, y que acabó mintiendo. Un `saldo`
en cero que nadie recalcula, un `postalCode` vacío que un comentario llamaba
«fiscal», una validación «válida» sobre datos editados después.

Antes de añadir una columna, contestá: **¿quién la escribe, cuándo, y qué pasa el
día que se desincronice del dato del que salió?** Si la respuesta es «se
recalcula», no es una columna: es una consulta.

---

## 1 · Dónde vive la tabla

```
tenant_<slug>   TODO lo de negocio. Aislado por empresa.
public          El plano de control y los catálogos públicos. Nada de negocio.
```

**La ausencia es el mecanismo de seguridad.** Ninguna tabla de negocio existe en
`public`, así que una consulta sin inquilino activo responde «relation does not
exist» — un error ruidoso, nunca los datos de otro cliente.

**La excepción, y por qué no rompe la regla:** los catálogos `sat_*` sí van en
`public`. No contienen datos de nadie —los publica el SAT para todo México— así
que leerlos sin inquilino no filtra nada. Y duplicarlos por esquema serían casi
cinco millones de filas idénticas con veinte inquilinos (`c_CodigoPostal` trae
~95 000 renglones y `c_Colonia` ~145 000).

La prueba para decidir: **¿esta tabla contendría un dato distinto para cada
empresa?** Si sí, va al inquilino. Si es la misma fila para todos y no dice nada
de nadie, va a `public`.

---

## 2 · Cuándo partir una entidad en 1:1

No por tamaño. **Por dueño, ritmo y consecuencia.**

`cliente_fiscal` y `cliente_comercial` cuelgan de `crm_organizations` en vez de
ser columnas suyas porque:

- el límite de crédito lo mueve quien vende, y equivocarse cuesta cartera;
- el régimen fiscal lo mueve quien factura, y equivocarse cuesta que **no salga
  la factura**;
- exigen **permisos distintos** (`clientes:editar` frente a `clientes:administrar`);
- y separadas, cada una habla su vocabulario: `cliente_fiscal` usa el del SAT, de
  modo que quien arme el XML no traduce nada.

Mezcladas en una tabla ancha, un `update` de descuentos toca la misma fila que el
RFC, la misma auditoría y los mismos permisos.

**Cuándo NO partir:** si los dos bloques se leen y se escriben siempre juntos, la
partición solo añade un `join`.

---

## 3 · Lo derivado no se guarda

`cliente_comercial` **no tiene columna `saldo`**, y es deliberado. El saldo es lo
facturado menos lo pagado: un resultado, no un dato. Guardarlo crea un número que
hay que mantener sincronizado a mano y que, el día que se desincronice —y se
desincroniza—, deja sin respuesta cuál es el bueno.

Es el criterio que ya seguía `payables`, donde el saldo sale del ledger.

> **Una columna en cero que nadie alimenta miente más que una columna ausente.**

La excepción es el rendimiento medido: si recalcular cuesta demasiado, se guarda
—y entonces se documenta quién la actualiza y se le pone una prueba. Ver el
comentario de `bytesDeAdjuntos`: hoy recorrer los adjuntos cuesta 40 ms y no se
guarda un total; el día que el cupo suba a 100 GB pasaría a 800 ms y entonces sí.

---

## 4 · La unicidad refleja el negocio, no la intuición

`cliente_fiscal` es único por **`(rfc, cp_fiscal)`**, no por `rfc`.

Un mismo RFC puede estar dos veces con toda legitimidad —matriz y sucursal con
condiciones comerciales distintas— y en un ERP ese es el caso frecuente. Lo que
no puede repetirse es el mismo contribuyente en el mismo domicilio fiscal: eso ya
es la misma ficha capturada dos veces.

Un único índice sobre `rfc` habría bloqueado el caso legítimo. **La restricción
que bloquea trabajo real acaba desactivada.**

---

## 5 · Índice único parcial antes que disparador

Un solo domicilio `fiscal` por cliente:

```sql
CREATE UNIQUE INDEX cliente_domicilio_fiscal_unico_idx
  ON cliente_domicilio (organization_id) WHERE tipo = 'fiscal';
```

Parcial, para que quepan tantos de envío como haga falta. Índice y **no**
disparador, porque un disparador es una regla que solo existe en producción y que
ninguna prueba ve venir.

---

## 6 · Llaves foráneas e índices

Postgres **no** indexa una FK por ti. Sin índice, cada borrado del padre recorre
la tabla hija entera.

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

**No las indexes todas**: un índice se paga en cada `INSERT`. Indexa las que estén
en tablas grandes **y** cuyo padre se borre o se consulte por ahí.

**Cuándo NO hace falta:** una FK que además es la llave primaria ya está indexada.
Es el caso de las tres tablas 1:1 del cliente.

---

## 7 · La redundancia que se acepta lleva fecha de caducidad

A veces dos columnas guardan lo mismo y está bien **durante una transición**. Lo
que no está bien es que nadie escriba cuándo termina.

Caso real, y el más instructivo de este repositorio:

| | |
|---|---|
| `crm_organizations.tax_id` | El RFC que trajo el padrón de SAE. Texto suelto, sin validar, sin régimen ni CP que lo acompañen. **Sirve para buscar, no para facturar.** |
| `cliente_fiscal.rfc` | El del expediente. Validado, con su régimen y su CP. **Es el que se timbra.** |

Se aceptan las dos porque el padrón no se puede trasladar automáticamente:
ninguna organización tiene régimen fiscal, que es obligatorio en CFDI 4.0, y
darlas por altas las marcaría como completas con datos que el SAT rechazaría.

**La condición de salida está escrita:** cuando todo cliente activo tenga
expediente, `tax_id` se deja de leer y se retira en una migración.

Y el caso gemelo, que salió peor: `crm_organizations` y `cliente_domicilio`
tienen **los mismos nueve campos de domicilio, en dos idiomas**. No es
redundancia —son dos domicilios distintos: dónde se OPERA (lo lee
`data/viaticos.ts` para saber a dónde viaja el técnico) y el de la CONSTANCIA
(lo que se timbra)— pero durante un tiempo el comentario del esquema llamaba
«domicilio fiscal» al operativo, y eso **es** una bomba: coger `org.postalCode`
para rellenar `cpFiscal` parece un atajo razonable y produce el rechazo CFDI40148.

Lección: **cuando dos tablas se parecen, la frontera se escribe en la definición
y se vigila con una prueba**, no se deja al criterio de quien pase por ahí.
`probe-clientes-fiscal` comprueba que el módulo que guarda el expediente ni
siquiera importe la tabla de organizaciones.

---

## 8 · Las bitácoras son append-only y se dice

`cliente_validacion_sat` guarda el ESTADO —«¿este cliente está listo para
facturarse?» se contesta con un valor actual, no recorriendo una historia—.
`cliente_validacion_sat_log` guarda lo que pasó, y ahí no se hace `update`
jamás.

Las dos hacen falta y contestan preguntas distintas. La segunda existe para
«¿desde cuándo dejó de valer?».

---

## 9 · Las migraciones se escriben a mano, en las DOS carpetas

`drizzle-kit generate` no sirve en ninguna de las dos. Ver la regla 4 de
`AGENTS.md`.

⚠ **Si tu migración de inquilino empieza con `CREATE TYPE`, cuidado con la
cabecera de comentarios.** El adaptador envuelve los `CREATE TYPE` en un
`EXCEPTION WHEN duplicate_object` para que el segundo inquilino los encuentre
hechos, y lo decidía mirando si el texto empieza por `CREATE TYPE`. Con la
cabecera delante no envolvía: el PRIMER inquilino migraba y el segundo moría con
«type already exists». Está arreglado en `prepareStatements`, pero el síntoma
—un inquilino al día y los demás clavados en la migración anterior, sin error a
la vista— es lo bastante desconcertante como para dejarlo escrito.

**Ninguna migración llega a producción sin haber corrido antes contra una copia
sincronizada.** Y se comprueba en los TRES inquilinos de la base de pruebas, no
solo en el primero: `npm run pruebas:base` los levanta.

---

## 10 · Cómo se comprueba que el modelo aguanta

No se opina: se mide, y contra volumen.

```bash
npm run pruebas:base     # 14 151 tickets, tres inquilinos
```

Y para una lista, se carga a mano hasta que duela:

```sql
insert into tenant_evoelution.crm_organizations (name, client_id)
  select 'CARGA '||g, '<uuid>' from generate_series(1,2000) g;
-- medir, y BORRAR
```

Medido así: `getClients()` con 88 clientes tarda 9,5 ms y con 2 088 tarda 51 ms.
Veinticuatro veces las filas por 5,4 veces el tiempo: **escalado sublineal**, el
modelo aguanta.

Lo que esa misma medición destapó es dónde está el techo de verdad, y no era el
modelo: **`getClients()` no tiene tope** — devuelve todos los clientes y la
pantalla los dibuja todos.

> Cuando alguien pregunte «¿esto escala?», la respuesta no es un análisis del
> esquema: es un número, contra volumen, y decir qué se rompe primero.

---

## Antes de dar por bueno un cambio de esquema

- [ ] ¿La tabla va al inquilino o a `public`? ¿Contendría un dato distinto por empresa?
- [ ] ¿Alguna columna nueva es un **derivado**? Entonces es una consulta.
- [ ] ¿La unicidad refleja lo que el negocio permite repetir?
- [ ] ¿Hay FK nuevas sobre tablas con volumen sin índice? (correr la consulta del §6)
- [ ] ¿Se parece a algo que ya existe? Escribí la frontera **en la definición** y ponele una prueba.
- [ ] ¿La migración corrió contra los tres inquilinos de la base de pruebas?
- [ ] ¿Hay una medida contra volumen, o solo una intuición?
