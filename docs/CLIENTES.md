# Clientes: el contrato de datos

> El catálogo de clientes de un ERP mexicano no es un directorio comercial: es
> un **expediente fiscal validado**. Desde CFDI 4.0 el SAT contrasta el nodo
> `Receptor` contra su padrón al timbrar, así que un cliente no está dado de
> alta cuando tiene nombre y teléfono, sino cuando sus cuatro datos fiscales
> coinciden con su Constancia de Situación Fiscal.
>
> Autoridad normativa: Anexo 20 (CFDI 4.0) y los catálogos `c_*` del SAT.

---

## 1. Por qué no hay una tabla `cliente`

La entidad ya existía. `crm_organizations` trae las organizaciones del padrón de
SAE con su RFC y su domicilio desarmado nodo por nodo del SAT. Una tabla
`cliente` al lado habría partido el padrón en dos y obligado a mantener
sincronizadas dos verdades sobre la misma empresa — y la que se desincroniza es
siempre la que no se está mirando.

Lo que faltaba no era la entidad: era el **expediente**. Se añade en tablas 1:1
colgadas de la organización, y se separan por una razón concreta.

**Lo fiscal y lo comercial tienen dueños, ritmos y consecuencias distintas.** El
límite de crédito lo mueve quien vende, y equivocarse cuesta cartera. El régimen
fiscal lo mueve quien factura, y equivocarse cuesta que no salga la factura.
Mezclados en una tabla ancha, un `update` de descuentos toca la misma fila que el
RFC, la misma auditoría y los mismos permisos. Separados, facturación no necesita
cargar el crédito y `cliente_fiscal` puede hablar el vocabulario del SAT en vez
del de la casa — que es lo que hace que quien arme el XML no traduzca nada.

```
crm_organizations ──1:1── cliente_fiscal          el expediente que se timbra
                  ──1:1── cliente_comercial       crédito, descuentos, contabilidad
                  ──1:1── cliente_validacion_sat  el veredicto del SAT, como ESTADO
                  ──1:N── cliente_domicilio       fiscal, envío, facturación, sucursal
                  ──1:N── cliente_campo_libre     lo que cada empresa quiera añadir
```

---

## 2. Dónde vive cada cosa

| Tabla | Esquema | Por qué ahí |
|---|---|---|
| `crm_organizations`, `cliente_*` | `tenant_<slug>` | Datos de negocio. Aislados por empresa. |
| `sat_*` | `public` | Catálogos del SAT: **públicos, idénticos para todos**. |

La regla de la casa es que ninguna tabla de negocio vive en `public`, para que
una consulta sin inquilino activo falle en vez de devolver datos ajenos. Los
catálogos del SAT no la rompen: no contienen datos de nadie. Y duplicarlos por
esquema sería insostenible — `c_CodigoPostal` trae unos 95 000 renglones y
`c_Colonia` unos 145 000; con veinte inquilinos son casi cinco millones de filas
idénticas que habría que actualizar una por una.

---

## 3. El bloque fiscal — `cliente_fiscal`

Uno a uno con la organización. **Todo lo que se timbra está aquí y solo aquí.**

| Columna | Nodo CFDI 4.0 | Regla |
|---|---|---|
| `rfc` | `Receptor@Rfc` | 12 (moral) o 13 (física). Sin espacios ni guiones, mayúsculas. Dígito verificador validado. |
| `nombre_fiscal` | `Receptor@Nombre` | **Ya normalizado**: mayúsculas, sin régimen de capital. Coincidencia exacta con la Constancia. |
| `nombre_capturado` | — | Lo que tecleó la persona, intacto. |
| `regimen_fiscal` | `Receptor@RegimenFiscalReceptor` | Clave de `c_RegimenFiscal`. |
| `cp_fiscal` | `Receptor@DomicilioFiscalReceptor` | Cinco dígitos. **El CP fiscal, nunca el de entrega.** |
| `pais_residencia` | `Receptor@ResidenciaFiscal` | `MEX` salvo receptor extranjero. |
| `num_reg_id_trib` | `Receptor@NumRegIdTrib` | Obligatorio para extranjeros. |
| `uso_cfdi_default` | `Receptor@UsoCFDI` | Sugerencia; el documento puede cambiarla. Sujeta a la matriz uso↔régimen. |
| `persona_tipo` | — | **Derivado del RFC**, nunca capturado. |
| `rol_fiscal` | — | `normal` \| `publico_general` \| `extranjero`. Decide qué se valida. |
| `curp` | — | Opcional, solo persona física. |
| `matriz_id` | — | Si es sucursal. Su CP fiscal es **siempre** el de la matriz. |

### Las cuatro decisiones que hay que conocer

**`nombre_fiscal` guarda el nombre normalizado, no el comercial.** El SAT no
tiene el régimen de capital: en la Constancia la razón social viene sin él.
`Comercializadora Ejemplo, S.A. de C.V.` se persiste como
`COMERCIALIZADORA EJEMPLO`. No es cosmética — es la causa número uno del
`CFDI40147`. De las 147 organizaciones con RFC que trajo el padrón de SAE, **75
llevaban el régimen de capital dentro del nombre**: se habrían rechazado todas al
primer intento de timbrado.

**`cp_fiscal` vive en el bloque fiscal y no en `cliente_domicilio`.** Es el único
dato de domicilio que viaja en el comprobante. Tenerlo aquí hace imposible el
error clásico: mandar el CP de la bodega a la que se entrega en vez del de la
matriz que está en la Constancia. El domicilio de entrega existe, y por
definición **no alimenta este campo**.

**El único índice de unicidad es `(rfc, cp_fiscal)`, no `rfc` solo.** Un mismo
RFC puede estar dos veces con toda legitimidad —matriz y sucursal con
condiciones comerciales distintas—. Lo que no puede repetirse es el mismo
contribuyente en el mismo domicilio fiscal: eso ya es la misma ficha capturada
dos veces. Un índice sobre el RFC solo habría bloqueado el caso legítimo, que en
un ERP es el más frecuente.

**No hay llaves foráneas a los catálogos `sat_*`.** Por dos razones: el
adaptador que aplica las migraciones por esquema quita la calificación
`"public".` de toda FK que no apunte al plano de control, así que apuntarían a
una tabla inexistente dentro del inquilino; y aunque se arreglara, los catálogos
llegan vacíos y una FK convertiría «todavía no puedo **validar** el régimen» en
«no puedes dar de alta un cliente». La integridad se comprueba en el dominio,
que sabe distinguir *inválido* de *no verificable*.

---

## 4. El bloque comercial — `cliente_comercial`

`clave` (10 caracteres, como SAE), `clasificacion`, `zona`, `maneja_credito`,
`dias_credito`, `limite_credito`, `descuento_pct`, `cuenta_contable`.

**No hay columna `saldo`, y es deliberado.** El saldo de un cliente es lo que se
le facturó menos lo que pagó: un derivado de cuentas por cobrar. Guardarlo aquí
crea un número que hay que mantener sincronizado a mano y que, el día que se
desincronice —y se desincroniza—, deja sin respuesta cuál es el bueno. Es el
criterio que ya sigue `payables`, donde el saldo sale del ledger. Cuando exista
cuentas por cobrar, el saldo se calcula; hasta entonces, no existe. **Una columna
en cero que nadie alimenta miente más que una columna ausente.**

---

## 5. El veredicto del SAT — `cliente_validacion_sat`

Se guarda como **estado**, no como evento suelto, porque la pregunta que se hace
todo el mundo es «¿este cliente está listo para facturarse?», y esa se contesta
con un valor actual. La historia existe igual en `cliente_validacion_sat_log`,
append-only, para cuando la pregunta sea «¿desde cuándo está mal?».

| Campo | Valores |
|---|---|
| `resultado` | `no_validado` · `valido` · `rfc_inexistente` · `nombre_no_coincide` · `cp_no_coincide` · `error` |
| `lista_69b` | `no_listado` · `presunto` · `desvirtuado` · `definitivo` · `sentencia_favorable` |
| `origen` | `pac` · `portal_sat_masiva` · `manual` |
| `hash_datos` | `sha256(rfc\|nombre\|cp\|regimen)` |

**El hash es lo que impide la mentira más peligrosa.** Un «válido» de hace tres
meses sobre un nombre que alguien editó ayer es peor que no haber validado nunca:
da confianza sin respaldo. Cuando cambia cualquiera de los cuatro campos que el
SAT contrasta, el hash deja de cuadrar y el veredicto se descarta solo.

Se compara en la capa de dominio y **no con un disparador de base**, a propósito:
un disparador no se puede probar desde un probe sin levantar Postgres, y ésta es
precisamente la regla que más falta hace poder probar.

Un cambio cosmético —una minúscula, un espacio de más— **no** invalida la
validación: el hash normaliza antes de resumir.

---

## 6. Las tres respuestas de la validación

Es la decisión de diseño que sostiene el módulo entero. `validarExpediente`
devuelve **tres** cosas, no dos:

| | Qué significa | Qué hace el sistema |
|---|---|---|
| **error** | El dato está mal y se sabe | No se guarda |
| **advertencia** | Podría estar mal y **no se puede saber aquí** | Se guarda, no se promete cumplimiento |
| **ok** | Todo lo comprobable, comprobado | — |

La de en medio es la que casi todos los sistemas se saltan, y es la que produce
las facturas rechazadas. La generan dos casos:

- el catálogo del SAT contra el que habría que comprobar **no está cargado**;
- la comprobación solo la puede hacer el SAT: si el RFC **existe** en el padrón y
  si el nombre coincide con la Constancia.

Devolver `ok` ahí sería mentir con aplomo: el usuario leería «datos fiscales
correctos» y el PAC le diría que no.

En consecuencia, **sin catálogos cargados un régimen inexistente no es inválido:
es incomprobable**, y el sistema lo dice con esas palabras.

### Códigos

Cuando existe un código oficial se usa ése:

| Código | Qué se rechaza |
|---|---|
| `CFDI40147` | El nombre no coincide con el padrón |
| `CFDI40148` | El código postal no coincide |
| `CFDI40149` | El régimen fiscal no coincide o no aplica al tipo de persona |
| `CFDI40158` | El `UsoCFDI` no es compatible con el régimen del receptor |

Un mensaje que dice «CFDI40158: el uso G01 no lo admite el régimen 605» se pega
en un buscador y llega a la documentación del SAT. Uno que dice «uso inválido»
obliga a preguntar.

---

## 7. Los catálogos del SAT — `sat_*`

| Tabla | Origen | Renglones aprox. |
|---|---|---|
| `sat_regimen_fiscal` | `c_RegimenFiscal` | 21 |
| `sat_uso_cfdi` | `c_UsoCFDI` | 24 |
| `sat_uso_regimen` | **derivada** de `c_UsoCFDI` | ~300 pares |
| `sat_codigo_postal` | `c_CodigoPostal` | ~95 000 |
| `sat_colonia` | `c_Colonia` | ~145 000 |
| `sat_forma_pago` | `c_FormaPago` | 21 |
| `sat_metodo_pago` | `c_MetodoPago` | 2 |
| `sat_pais` | `c_Pais` | ~250 |

**`sat_uso_regimen` no se escribe a mano. Nunca.** Se deriva de la columna
«Régimen Fiscal Receptor» de `c_UsoCFDI`, donde el SAT lista por cada uso los
regímenes que lo admiten. Escribirla a mano tiene dos problemas y los dos son
graves: se equivoca —y el resultado es justamente el rechazo que la tabla existe
para evitar— y se queda vieja, porque el SAT la cambia sin avisar.

**Las migraciones crean la forma; llegan vacías.** No se siembran valores «de
referencia» porque **un catálogo fiscal a medias es peor que uno vacío**: vacío,
el sistema dice que no puede validar; a medias, valida mal y con aplomo.

`sat_catalogo` registra qué hay cargado, de qué archivo, con qué hash y en qué
versión, para que «¿contra qué catálogo se validó esta factura?» tenga respuesta
dentro del sistema y no dependa de la memoria de nadie.

**Vigencias:** un régimen dado de baja no se borra. Deja de ofrecerse en altas
nuevas y sigue resolviendo para los CFDI históricos que lo llevan; borrarlo
dejaría comprobantes ya timbrados apuntando a la nada.

---

## 8. Los tres receptores

### Normal
Se contrasta contra el padrón del SAT. Es el único que se valida.

### Público en general
```
rol_fiscal     = 'publico_general'
rfc            = 'XAXX010101000'
nombre_fiscal  = 'PUBLICO EN GENERAL'   (literal, sin acento)
regimen_fiscal = '616'
uso_cfdi       = 'S01'
cp_fiscal      = CP del LUGAR DE EXPEDICIÓN DEL EMISOR   ← no el del cliente
```
No se valida contra el SAT: no está en el padrón. La factura global además exige
el nodo `InformacionGlobal` (`Periodicidad`, `Meses`, `Año`), que vive en el
documento y no en el catálogo.

### Extranjero
```
rol_fiscal      = 'extranjero'
rfc             = 'XEXX010101000'
pais_residencia ≠ 'MEX'          (obligatorio)
num_reg_id_trib = tax ID del país (obligatorio)
cp_fiscal       = CP del lugar de expedición del emisor
```

### Matriz y sucursal
La sucursal tiene ficha propia con `matriz_id`, pero **`cp_fiscal` es siempre el
de la matriz**: el SAT no conoce sucursales, conoce RFC, y el
`DomicilioFiscalReceptor` es el de la Constancia. El domicilio de la sucursal va
a `cliente_domicilio` con tipo `sucursal` o `envio` y **jamás alimenta el nodo
fiscal**. Si se captura un CP distinto, se guarda y se advierte que no es el que
se timbrará.

---

## 9. Invariantes que la base garantiza

- `cliente_fiscal(rfc, cp_fiscal)` es único.
- **Un solo domicilio `fiscal` por cliente**, por índice único **parcial**
  (`WHERE tipo = 'fiscal'`). Parcial y no total para que quepan tantos domicilios
  de envío como haga falta; índice y no disparador porque un disparador es una
  regla que solo existe en producción y que ninguna prueba ve venir.
- `cliente_validacion_sat_log` es **append-only**. Ahí no se hace `update`.

---

## 10. Qué se comprueba, y dónde

`probe-clientes-fiscal.mts` — sin base de datos, en el trabajo rápido del CI.
Los catálogos entran como parámetro, que es por lo que `validarExpediente` los
recibe en vez de leerlos: **una regla fiscal que solo se puede probar levantando
Postgres es una regla que nadie prueba.**

Cubre RFC (forma, fecha, dígito verificador), normalización del nombre, la matriz
uso↔régimen, régimen contra tipo de persona, código postal, los dos RFC
genéricos, la herencia de CP de la matriz, y la caducidad del veredicto por hash.

**El algoritmo del dígito verificador está medido, no supuesto:** se corrió
contra los 147 RFC reales del padrón y coincide en el **98,0 %**. Si estuviera
mal, la tasa rondaría el 9 % (1 entre 11 por azar). Los tres que no cuadran son
captura mala del padrón de SAE — justo lo que este módulo existe para encontrar.

---

## 11. Lo que todavía no está

Escrito aquí para que nadie lo dé por hecho al leer lo de arriba:

- **El servicio de validación ante el SAT** (`ValidadorFiscal`): el puerto está
  descrito, los adaptadores (PAC, portal masivo, mock) no están escritos. Hoy
  `resultado` solo se puede poner a mano.
- **El cargador de catálogos** `npm run sat:catalogos`: las tablas existen y
  están vacías.
- **La UI por pestañas** y las acciones de servidor del alta y edición.
- **Importación / exportación CSV** con dry-run.
- **Bloqueo de facturación por lista 69-B**: la columna existe, nadie la lee.
- **`npm run clientes:adoptar`**: el traslado de las 147 organizaciones con RFC
  al expediente fiscal, con reporte de incidencias. La migración **no** mueve
  datos a propósito — ninguna tiene régimen fiscal, que es obligatorio, y darlas
  por altas las marcaría como expediente completo con datos que el SAT
  rechazaría (regla 9 de `AGENTS.md`).
