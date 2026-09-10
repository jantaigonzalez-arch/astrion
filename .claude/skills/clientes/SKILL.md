---
name: clientes
description: Tocar el catálogo de clientes, el expediente fiscal o cualquier cosa que acabe en un CFDI — alta y edición de clientes, RFC, régimen fiscal, uso de CFDI, código postal fiscal, validación ante el SAT, catálogos c_*, importación del padrón. Úsalo ANTES de escribir código que capture, valide o timbre datos de un receptor, y antes de añadir una columna al expediente. Las reglas de aquí son fiscales: equivocarse no da un aviso, da una factura rechazada.
---

# Clientes y CFDI 4.0

## La regla que ordena todo lo demás

**Un dato fiscal mal capturado no produce una advertencia: produce un rechazo
del PAC.**

Desde CFDI 4.0 el SAT contrasta el nodo `Receptor` contra su padrón en el
momento de timbrar. No hay margen de interpretación y no hay «se corrige
después»: la factura no sale, el cliente espera, y quien lo descubre es quien
está facturando a las seis de la tarde del último día del mes.

Por eso el catálogo de clientes de este ERP **no es un directorio comercial**.
Es un expediente fiscal validado, y todo lo demás —crédito, descuentos,
vendedor— es secundario y vive aparte para no contaminarlo.

El contrato de datos completo está en **[`docs/CLIENTES.md`](../../../docs/CLIENTES.md)**.
Esto es lo que hay que tener en la cabeza antes de abrir un archivo.

---

## Lo primero: dónde está cada cosa

```
src/lib/domain/fiscal.ts     RFC, CURP, normalización del nombre. PURO.
src/lib/domain/cliente.ts    el expediente completo: reglas que cruzan campos
                             y contra catálogos. PURO — los catálogos entran
                             como parámetro.
src/lib/db/schema.ts         cliente_fiscal, cliente_comercial, cliente_domicilio,
                             cliente_validacion_sat(+_log), cliente_campo_libre
src/lib/db/platform.ts       los catálogos sat_* (viven en `public`)
probe-clientes-fiscal.mts    los criterios de aceptación, sin base de datos
```

**Las dos capas de dominio son puras a propósito.** Los catálogos del SAT entran
como parámetro en vez de leerse de la base, y eso no es purismo: una regla fiscal
que solo se puede probar levantando Postgres es una regla que nadie prueba. Si
vas a añadir una regla, añádela ahí y no en la pantalla — la importación masiva
se salta la pantalla.

---

## Las cinco trampas, en orden de lo que más ha dolido

### 1 · El nombre que se timbra NO es el nombre de la empresa

`Receptor@Nombre` tiene que coincidir **exactamente** con la Constancia de
Situación Fiscal, y la Constancia **no lleva el régimen de capital**.

```
se captura:   Comercializadora Ejemplo, S.A. de C.V.
se timbra:    COMERCIALIZADORA EJEMPLO
```

Es la causa número uno del `CFDI40147`. En este repositorio está medido: de las
147 organizaciones con RFC que trajo el padrón de SAE, **75 llevaban el régimen
de capital dentro del nombre**. Las 75 se habrían rechazado al primer intento.

`normalizarNombreFiscal()` lo hace, y guarda además lo tecleado en
`nombre_capturado`. **No borres `nombre_capturado` por parecerte redundante**: es
lo único que permite explicarle a alguien por qué el sistema va a timbrar algo
distinto de lo que escribió.

Y lo que **no** hay que quitar: acentos y `Ñ`. El padrón los tiene, y quitarlos
provoca el mismo rechazo que se intenta evitar.

### 2 · El CP fiscal no es el CP de entrega

`Receptor@DomicilioFiscalReceptor` es el código postal **de la Constancia** —el
de la matriz—, no el de la bodega a la que se entrega. Por eso `cp_fiscal` vive
en `cliente_fiscal` y no en `cliente_domicilio`: si estuvieran juntos, alguien
acabaría timbrando el de envío.

**Una sucursal no tiene domicilio fiscal propio.** El SAT no conoce sucursales,
conoce RFC. Si `matriz_id` está puesto, el CP que se timbra es el de la matriz,
siempre. El domicilio de la sucursal existe y sirve para mandar a un técnico,
pero no toca el nodo fiscal.

### 3 · La matriz uso ↔ régimen NO se escribe a mano

`sat_uso_regimen` se **deriva** de la columna «Régimen Fiscal Receptor» de
`c_UsoCFDI`. Escribirla a mano se equivoca —y el resultado es exactamente el
`CFDI40158` que la tabla existe para evitar— y se queda vieja, porque el SAT la
cambia sin avisar.

Regla práctica para la UI: **filtra el selector de uso de CFDI por el régimen del
receptor.** No muestres opciones inválidas para rechazarlas tres pantallas
después.

### 4 · Hay TRES respuestas, no dos

Esta es la que más se salta y la que más caro sale:

| | |
|---|---|
| **error** | el dato está mal y se sabe → no se guarda |
| **advertencia** | podría estar mal y **no se puede saber aquí** → se guarda, no se promete nada |
| **ok** | todo lo comprobable, comprobado |

Sin los catálogos del SAT cargados, un régimen inexistente **no es inválido: es
incomprobable**. Y si el RFC existe de verdad en el padrón, o si el nombre
coincide con la Constancia, eso **solo lo contesta el SAT** — nunca este código.

Devolver `ok` en esos casos es mentir con aplomo: el usuario lee «datos fiscales
correctos» y el PAC le dice que no. Es la regla 9 de `AGENTS.md` aplicada al
dinero de alguien.

### 5 · Un «válido» viejo sobre datos nuevos es peor que no haber validado

`cliente_validacion_sat.hash_datos` guarda el sha256 de los cuatro campos que el
SAT contrasta. Si alguien edita el nombre, el RFC, el CP o el régimen, el hash
deja de cuadrar y el veredicto **se descarta solo**.

Se comprueba **al leer**, no solo al escribir: una fila cuyo hash no cuadra está
mostrando un veredicto caduco venga de donde venga el cambio — una edición, una
importación, un `update` a mano en una consola.

Un cambio cosmético (minúsculas, un espacio de más) **no** invalida: el hash
normaliza antes de resumir.

---

## Cosas que ya se decidieron, para no volver a discutirlas

**No hay tabla `cliente`.** La entidad es `crm_organizations`, con el padrón de
SAE dentro. El expediente cuelga de ella en tablas 1:1. Crear una tabla nueva
partiría el padrón en dos.

**No hay columna `saldo`.** Es un derivado de cuentas por cobrar. Una columna en
cero que nadie alimenta miente más que una columna ausente.

**No hay FK a los catálogos `sat_*`.** El adaptador de migraciones por esquema
quita la calificación `"public".` de las FK que no apuntan al plano de control
(ver `prepareStatements`), así que acabarían apuntando a una tabla inexistente. Y
aunque se arreglara: los catálogos llegan vacíos, y una FK convertiría «no puedo
validar el régimen» en «no puedes dar de alta un cliente».

**El único índice único es `(rfc, cp_fiscal)`.** Un mismo RFC dos veces es
legítimo —matriz y sucursal—. Lo que no puede repetirse es el mismo contribuyente
en el mismo domicilio fiscal.

**Un solo domicilio fiscal por cliente, con índice único PARCIAL**
(`WHERE tipo = 'fiscal'`). Parcial para que quepan tantos de envío como haga
falta; índice y no disparador porque un disparador es una regla que solo existe
en producción y que ninguna prueba ve venir.

---

## Antes de tocar nada

```bash
npx tsx --tsconfig tsconfig.check.json probe-clientes-fiscal.mts
```

Sin base de datos, medio segundo. Si lo que vas a cambiar es una regla fiscal,
**escribe primero la comprobación ahí** y míralas fallar: en este repositorio ya
pasó que una aserción se cumpliera por una razón que no era la que decía —el RFC
de ejemplo tenía el dígito verificador mal y solo lo delató el único caso que
comprobaba `ok` en vez de buscar un código concreto—.

Si tocas el esquema:

```bash
npm run pruebas:base        # aplica las migraciones a los TRES inquilinos
npm run test:todo
```

Las migraciones se escriben **a mano** en las dos carpetas (regla 4 de
`AGENTS.md`). Y una trampa concreta: si tu migración de inquilino empieza con un
`CREATE TYPE`, **no le pongas la cabecera de comentarios justo antes sin
comprobarlo** — la envoltura `EXCEPTION WHEN duplicate_object` se aplicaba mirando
si el texto empieza por `CREATE TYPE`, y con la cabecera delante el primer
inquilino migraba y el segundo moría. Está arreglado en `prepareStatements`, pero
el síntoma —`evoelution` al día y `acme` clavado en la migración anterior, sin
error a la vista— es lo bastante desconcertante como para dejarlo escrito.

---

## Lo que todavía no existe

No lo des por hecho al leer lo de arriba: el `ValidadorFiscal` (puerto descrito,
adaptadores sin escribir), el cargador `npm run sat:catalogos` (las tablas
existen y están **vacías**), la UI por pestañas, la importación CSV con dry-run,
el bloqueo por lista 69-B, y `npm run clientes:adoptar`, que es el traslado de
las 147 organizaciones con RFC al expediente — deliberadamente fuera de la
migración, porque ninguna tiene régimen fiscal y darlas por altas las marcaría
como expediente completo con datos que el SAT rechazaría.
