# Módulo de Clientes — CFDI 4.0

> Todo lo que tiene que ver con el catálogo de clientes: para qué existe, qué
> significa cada dato, qué se valida y por qué, cómo se opera y qué garantiza la
> base. Este documento es la fuente de la que sale el manual de usuario.
>
> Autoridad normativa: **Anexo 20 (CFDI 4.0)** y los catálogos `c_*` del SAT.

---

## Cómo leer este documento

Cada sección lleva una marca de estado. **No la ignores al escribir el manual de
usuario**: describir una pantalla que todavía no existe como si existiera es la
forma más rápida de que un manual pierda la confianza de quien lo usa.

| Marca | Significa |
|---|---|
| ✅ | Construido y probado. Se puede documentar como algo que se hace hoy. |
| 📐 | Diseñado y decidido, **sin construir**. Es especificación, no realidad. |

---

## Índice

1. [Para qué existe este módulo](#1-para-qué-existe-este-módulo)
2. [Vocabulario](#2-vocabulario)
3. [Los tres tipos de cliente](#3-los-tres-tipos-de-cliente)
4. [El expediente, campo por campo](#4-el-expediente-campo-por-campo)
5. [Las tres respuestas de la validación](#5-las-tres-respuestas-de-la-validación)
6. [Qué se rechaza y qué hacer](#6-qué-se-rechaza-y-qué-hacer)
7. [El ciclo de vida de un cliente](#7-el-ciclo-de-vida-de-un-cliente)
8. [Los procesos](#8-los-procesos)
9. [Quién puede hacer qué](#9-quién-puede-hacer-qué)
10. [El contrato de datos](#10-el-contrato-de-datos)
11. [Los catálogos del SAT](#11-los-catálogos-del-sat)
12. [Qué se comprueba, y dónde](#12-qué-se-comprueba-y-dónde)
13. [Lo que todavía no existe](#13-lo-que-todavía-no-existe)

---

## 1. Para qué existe este módulo

**El catálogo de clientes de un ERP mexicano no es un directorio comercial: es un
expediente fiscal validado.**

Hasta CFDI 3.3, facturarle a alguien pedía poco más que su RFC. Desde **CFDI
4.0** el SAT contrasta el nodo `Receptor` **contra su padrón, en el momento de
timbrar**. Ya no basta con que el dato esté bien escrito: tiene que ser
literalmente el que el SAT tiene registrado.

Y cuando no lo es, no hay aviso ni tolerancia: **el PAC rechaza la factura**. La
factura no sale, el cliente espera, y quien lo descubre es quien está facturando
a las seis de la tarde del último día del mes.

De ahí las dos consecuencias que ordenan todo el módulo:

1. **Lo fiscal se valida al capturar, no al facturar.** Un error encontrado
   cuando se da de alta al cliente cuesta un minuto; el mismo error encontrado al
   timbrar cuesta una factura y una llamada.
2. **Lo comercial no contamina lo fiscal.** El crédito, el descuento y el
   vendedor son importantes, pero equivocarse en ellos cuesta cartera. Equivocarse
   en el régimen fiscal cuesta que no salga la factura. Son cosas distintas y
   viven separadas.

### El número que justifica el módulo

Se midió contra el padrón real que trajo la migración de SAE: **147
organizaciones con RFC**.

- **75 de las 147** llevaban el régimen de capital dentro del nombre
  (`… S.A. de C.V.`). Las 75 se habrían rechazado con `CFDI40147` al primer
  intento de timbrado.
- **3 de las 147** tienen el RFC mal capturado (el dígito verificador no cuadra).
- **Ninguna** tenía régimen fiscal, que en CFDI 4.0 es obligatorio.

Es decir: **hoy, sin este módulo, más de la mitad del padrón no se puede
facturar.**

---

## 2. Vocabulario

Para el manual de usuario, esta sección va primero. Casi todo el soporte del
módulo consiste en explicar estas siete palabras.

**RFC** — Registro Federal de Contribuyentes. 12 caracteres para una empresa
(persona moral), 13 para una persona (persona física). El último carácter es un
dígito de control que se calcula a partir de los demás: por eso el sistema puede
detectar un RFC mal tecleado sin preguntarle a nadie.

**Persona física / persona moral** — una persona de carne y hueso frente a una
empresa. **No se captura**: se deduce de la longitud del RFC. Preguntarlo solo
abriría la puerta a que no coincidan.

**Constancia de Situación Fiscal (CSF)** — el documento que el SAT emite con los
datos fiscales oficiales de un contribuyente: nombre, régimen y código postal.
**Es la fuente de verdad.** Cuando el sistema y la Constancia discrepan, la
Constancia tiene razón.

**Régimen fiscal** — bajo qué reglas tributa el contribuyente (`601` General de
Ley Personas Morales, `605` Sueldos y Salarios, `626` RESICO…). Obligatorio desde
CFDI 4.0 y **tiene que ser el que dice la Constancia**, no el que parezca
razonable.

**Uso del CFDI** — para qué va a usar el receptor esa factura (`G01` adquisición
de mercancías, `G03` gastos en general, `D01` deducciones personales…). **No todos
los usos son compatibles con todos los regímenes**, y ahí está el error
`CFDI40158`.

**Timbrar** — mandar la factura al PAC para que le ponga el sello del SAT. Es el
momento en el que todo lo anterior se verifica de golpe.

**PAC** — Proveedor Autorizado de Certificación. El intermediario que timbra. Es
quien devuelve el rechazo.

**Lista 69-B** — la lista pública de contribuyentes con operaciones
presuntamente inexistentes ("empresas fantasma"). Facturarle a alguien en estado
`definitivo` tiene consecuencias fiscales para quien emite.

---

## 3. Los tres tipos de cliente

El campo `rol_fiscal` no es una etiqueta descriptiva: **decide qué se valida.**

### 3.1 Normal ✅

Un cliente con RFC propio. Es el único que se contrasta contra el padrón del SAT.

### 3.2 Público en general ✅ (reglas) · 📐 (alta automática)

Para la **factura global**: el resumen de todas las ventas de mostrador de un
periodo, que se emite a un receptor genérico.

```
RFC             XAXX010101000
Nombre          PUBLICO EN GENERAL      ← literal, sin acento
Régimen         616  (sin obligaciones fiscales)
Uso             S01  (sin efectos fiscales)
Código postal   el del LUGAR DE EXPEDICIÓN del emisor  ← no el del cliente
```

**Su bloque fiscal es de solo lectura y no se valida ante el SAT**: no está en el
padrón, y validarlo daría siempre «no existe».

Un detalle que sorprende y hay que explicar en el manual: **el código postal es
el de quien emite, no el de quien compra.** No hay «quien compra» — es el público.

> La factura global además exige el nodo `InformacionGlobal` (`Periodicidad`,
> `Meses`, `Año`), que vive en el documento, no en el catálogo de clientes.

### 3.3 Extranjero ✅

Un cliente sin RFC mexicano.

```
RFC              XEXX010101000
País residencia  distinto de MEX          ← obligatorio
Registro trib.   el tax ID de su país     ← obligatorio
Código postal    el del lugar de expedición del emisor
```

Si falta el número de registro tributario, **el cliente no se puede guardar**. No
es una advertencia: el CFDI no se puede armar sin ese dato.

### 3.4 Matriz y sucursal ✅

Una sucursal puede tener su propia ficha, con sus condiciones comerciales y su
domicilio. Pero:

> **El SAT no conoce sucursales: conoce RFC.**

Una sucursal es el mismo contribuyente, así que su código postal fiscal es
**siempre el de la matriz** — el de la Constancia. Su domicilio propio se guarda
como domicilio de envío y sirve para mandar a un técnico, pero **nunca alimenta
la factura**.

Si alguien captura un CP distinto en una sucursal, el sistema lo guarda y
**avisa** de que no es el que se va a timbrar.

---

## 4. El expediente, campo por campo

### 4.1 Bloque fiscal — lo que se timbra ✅

| Campo | Qué es | Quién lo llena | Si está mal |
|---|---|---|---|
| **RFC** | El identificador fiscal | Quien da de alta | La factura no sale |
| **Nombre fiscal** | La razón social **como está en la Constancia** | El sistema lo normaliza | `CFDI40147` |
| **Régimen fiscal** | Bajo qué reglas tributa | Se copia de la Constancia | `CFDI40149` |
| **CP fiscal** | El código postal **de la Constancia** | Se copia de la Constancia | `CFDI40148` |
| **País de residencia** | `MEX` salvo extranjeros | Automático | Rechazo |
| **Núm. registro tributario** | Tax ID del extranjero | Solo extranjeros | No se puede guardar |
| **CURP** | Opcional, solo personas físicas | Quien da de alta | Se rechaza si no es válida |
| **Uso de CFDI por omisión** | Sugerencia para la factura | Se acuerda con el cliente | `CFDI40158` |
| **Tipo de persona** | Física o moral | **Derivado del RFC** | — |

#### El nombre fiscal no es el nombre de la empresa

Esta es **la explicación que más veces va a dar soporte**, y conviene que en el
manual tenga su propio recuadro:

```
Lo que dice la papelería:   Comercializadora Ejemplo, S.A. de C.V.
Lo que se va a timbrar:     COMERCIALIZADORA EJEMPLO
```

El SAT **no tiene el régimen de capital** en su padrón. En la Constancia la razón
social viene sin `S.A. de C.V.`, sin `S. de R.L.`, sin `SAPI`. Timbrar el nombre
completo es la causa número uno del rechazo `CFDI40147`.

El sistema lo quita solo, y **guarda además lo que se tecleó**, para poder
explicar por qué va a mandar algo distinto de lo que se escribió.

Lo que **sí** se conserva: **acentos y Ñ**. El padrón los tiene, y quitarlos
provoca exactamente el mismo rechazo que se intenta evitar.

#### El CP fiscal no es el CP de entrega

El otro error clásico. El código postal que viaja en la factura es el de la
**Constancia** —normalmente el de las oficinas—, no el de la bodega a la que se
entrega la mercancía. Por eso el CP fiscal vive en el bloque fiscal y el
domicilio de entrega vive aparte: si estuvieran juntos, alguien acabaría
timbrando el equivocado.

### 4.2 Bloque comercial — lo que no bloquea la factura ✅

Clave del cliente (10 caracteres, como en SAE), clasificación, zona, si maneja
crédito, días de crédito, límite de crédito, descuento y cuenta contable.

**No hay campo «saldo», y es a propósito.** El saldo es lo que se le facturó
menos lo que pagó: un resultado, no un dato. Guardarlo crea un número que hay que
mantener sincronizado a mano y que, el día que se desincronice, deja sin
respuesta cuál es el bueno. Cuando exista el módulo de cuentas por cobrar, el
saldo se calculará.

> Para el manual: si alguien pregunta «¿dónde veo el saldo del cliente?», la
> respuesta honesta hoy es «todavía no existe», no «está en cero».

### 4.3 Domicilios ✅

Un cliente puede tener varios: `fiscal`, `envio`, `facturacion`, `sucursal`.
**Solo puede haber uno fiscal**, y la base lo garantiza.

**El domicilio fiscal se captura con los datos fiscales, no con la ficha de la
organización.** Es una corrección deliberada: al principio el código postal
fiscal vivía en el bloque fiscal y la calle en la ficha de la organización —que
es el domicilio COMERCIAL, donde se entrega—. Dos domicilios en dos pantallas, y
el de entrega a un clic del que se timbra: es exactamente cómo se acaba mandando
el CP de la bodega en una factura.

**El código postal se captura UNA vez** y alimenta los dos sitios:
`cliente_fiscal.cp_fiscal`, que es el que se timbra, y `cliente_domicilio.cp` del
domicilio de tipo `fiscal`. No hay dos campos que puedan discrepar porque no hay
dos campos — y el CP del domicilio no sale del formulario, sale de lo que se
acaba de validar, así que no se pueden separar ni manipulando el envío.

Los campos son los del nodo `Domicilio` del SAT: calle, número exterior e
interior, colonia, localidad, municipio, estado, CP, país, referencia y entre
calles.

De todos ellos, **solo el código postal viaja en la factura**. Los demás se
capturan porque hacen falta para operar —mandar a un técnico, imprimir un
contrato— y porque el día que haya Carta Porte ya estarán.

### 4.4 Campos libres ✅

Lo que cada empresa necesita y nadie más. Equivalente al `CLIE_CLIB` de SAE.

---

## 5. Las tres respuestas de la validación

**Es la decisión de diseño que sostiene el módulo entero**, y la que hay que
explicar bien en el manual, porque contradice lo que la gente espera de un
formulario.

| Respuesta | Qué significa | Qué hace el sistema |
|---|---|---|
| 🔴 **Error** | El dato está mal y **se sabe** | No deja guardar |
| 🟡 **Advertencia** | Podría estar mal y **no se puede saber aquí** | Guarda, pero no promete nada |
| 🟢 **Correcto** | Todo lo comprobable, comprobado | — |

La de en medio es la que casi todos los sistemas se saltan, y es la que produce
las facturas rechazadas. Aparece en dos situaciones:

**a) El catálogo del SAT no está cargado.** Sin `c_RegimenFiscal`, un régimen
inexistente **no es inválido: es incomprobable**. Decir «correcto» sería inventar
un veredicto.

**b) La comprobación solo la puede hacer el SAT.** Que el RFC **exista** en el
padrón y que el nombre **coincida** con la Constancia no lo puede saber ningún
programa. Solo el SAT.

> Por eso, en un cliente normal, **el nombre queda siempre advertido hasta que se
> valida ante el SAT**. No es ruido: es el error de timbrado más frecuente que
> existe, y lo que lo causa es exactamente creer que un nombre bien escrito es un
> nombre correcto.

**Un semáforo verde antes de validar ante el SAT sería mentir con aplomo:** el
usuario leería «datos fiscales correctos» y el PAC le diría que no.

---

## 6. Qué se rechaza y qué hacer

Tabla directamente reutilizable en el manual. Los códigos son los del SAT, así
que se pueden pegar en un buscador.

| Código | Mensaje | Qué pasó | Qué hacer |
|---|---|---|---|
| `CFDI40147` | El nombre no coincide | Se está mandando la razón social con régimen de capital, o con una letra distinta | Copiar el nombre **tal cual** de la Constancia |
| `CFDI40148` | El CP no coincide | Se capturó el CP de entrega, o uno que no existe | Copiar el CP **fiscal** de la Constancia |
| `CFDI40149` | El régimen no coincide | El régimen no es el de la Constancia, o no aplica al tipo de persona | Copiar el régimen de la Constancia |
| `CFDI40158` | Uso incompatible | El uso elegido no lo admite el régimen del receptor | Elegir un uso de los que ofrece el selector |

Errores propios del sistema, con mensaje en lenguaje llano:

| Situación | Mensaje |
|---|---|
| RFC con fecha imposible | «Los seis dígitos centrales del RFC no son una fecha real» |
| RFC mal tecleado | «El último carácter del RFC no corresponde: revisa la captura» |
| Extranjero sin tax ID | «Un receptor extranjero necesita su número de registro tributario» |
| RFC genérico en cliente normal | «Ese es un RFC genérico del SAT. Marca el cliente como público en general o como extranjero» |
| CURP en persona moral | «La CURP es de una persona física; este RFC es de persona moral» |

---

## 6b. El semáforo de la lista y de la ficha ✅

Lo que se ve de un vistazo en `Clientes` y en cada ficha. **Cinco estados, no
dos**, porque la distancia hasta poder facturar es distinta en cada uno y un
estado que no la distingue manda a todo el mundo a abrir fichas para averiguar
cuál es cuál.

| Estado | Qué significa | Qué hacer |
|---|---|---|
| **Sin RFC** | No tiene ningún dato fiscal | Pedirle al cliente su Constancia |
| **Falta régimen y CP** | Tiene el RFC del padrón de SAE | Copiar régimen y CP de la Constancia — **un minuto** |
| **Sin validar** | Expediente completo, nadie lo contrastó | Validarlo ante el SAT |
| **Nombre / CP / RFC no coincide** | El SAT lo rechazó | Corregir con la Constancia a la vista |
| **Validado** | El SAT confirmó los cuatro datos | Nada: se le puede facturar |

**Verde significa que el SAT dijo que sí**, no que los datos se vean bien.

> **Por qué al principio todos dicen lo mismo.** Al estrenar el módulo, `cliente_fiscal`
> está vacía: la migración **no** traslada el padrón viejo, porque ninguna
> organización tiene régimen fiscal —obligatorio en CFDI 4.0— y darlas por altas
> las marcaría como expediente completo con datos que el SAT rechazaría. Los que
> tienen RFC del padrón aparecen como **«Falta régimen y CP»**, que es cierto y es
> por donde conviene empezar.

---

## 7. El ciclo de vida de un cliente

```
   ALTA ──► no_validado ──► [validación ante el SAT] ──┬──► valido
                  ▲                                    ├──► rfc_inexistente
                  │                                    ├──► nombre_no_coincide
                  │                                    ├──► cp_no_coincide
                  └────────── se edita un dato ────────┴──► error
                              fiscal (vuelve solo)
```

### El veredicto caduca solo ✅

**Un «válido» de hace tres meses sobre un nombre que alguien editó ayer es peor
que no haber validado nunca: da confianza sin respaldo.**

El sistema guarda una huella de los cuatro campos que el SAT contrasta. Si
alguien cambia el RFC, el nombre, el CP o el régimen —da igual desde dónde: la
pantalla, una importación o una corrección masiva—, la huella deja de cuadrar y
**el estado vuelve a `no validado` por sí solo**.

Un cambio cosmético (una minúscula, un espacio de más) **no** invalida nada.

### Lista 69-B ✅ (dato) · 📐 (bloqueo)

Cada cliente lleva su estado en la lista: `no_listado`, `presunto`,
`desvirtuado`, `definitivo`, `sentencia_favorable`.

✅ Cada empresa decide qué hacer con un cliente `presunto` y con uno
`definitivo` —nada, avisar en su ficha o bloquear contratos y tickets nuevos—, en
Configuración → Clientes (0038). Lo hace cumplir `vetoLista69b`; lo ya firmado no
se toca, y `desvirtuado` / `sentencia_favorable` nunca bloquean.

📐 Falta el **cargador** de la lista del SAT: hoy nada alimenta el estatus, así
que todo cliente está en `no_listado` y la política no tiene a quién aplicarse.
El bloqueo de **facturación** llegará con la facturación.

---

## 8. Los procesos

### 8.1 Dar de alta un cliente 📐

Formulario por pestañas, réplica del expediente de SAE:

1. **Datos generales** — clave, nombre comercial, estatus, clasificación, zona, vendedor
2. **Datos fiscales** — RFC, nombre, régimen, CP fiscal, CURP, país, registro tributario, y el botón **«Validar ante el SAT»** con semáforo y fecha de la última validación
3. **Domicilios** — la lista; el fiscal marcado
4. **Comercial** — crédito, días, límite, descuento, moneda
5. **Facturación** — uso de CFDI, forma y método de pago, contacto que recibe el XML y el PDF
6. **Contable** — cuenta contable de ventas
7. **Campos libres**

Los cuatro detalles que evitan la mayoría de los errores:

- Al teclear el **código postal**, cargar las colonias del SAT en un desplegable
  — no en un campo libre.
- Al elegir el **régimen**, filtrar el selector de uso de CFDI. **No mostrar
  opciones inválidas para rechazarlas tres pantallas después.**
- En el campo de nombre, una nota: *«tal como aparece en la Constancia, sin S.A.
  de C.V.»*, y **la vista previa de lo que se va a timbrar**.
- Permitir **subir la Constancia en PDF** y prellenar RFC, nombre, régimen y CP
  leyendo su QR. Es el mayor ahorro de fricción del módulo.

### 8.2 Validar ante el SAT 📐

**Realidad técnica que conviene que el manual no esconda:** el SAT **no publica
una API** para validar RFC + nombre + CP. Hay tres caminos y el sistema los trata
como intercambiables:

| Camino | Para qué | Límite |
|---|---|---|
| **API del PAC** | Validación individual, en el formulario | Depende del contrato con el PAC |
| **Portal de validación masiva del SAT** | Lotes | **5 000 registros por lote** |
| **Listas 69-B y LCO** | Descarga pública | Sincronización diaria |

El sistema está diseñado como **puerto y adaptador**: el dominio nunca conoce al
PAC, de modo que cambiar de proveedor no toca ninguna regla fiscal.

### 8.3 Validación masiva 📐

Trabajo en segundo plano con progreso, troceado automático en 5 000, y un reporte
descargable con los clientes en `nombre_no_coincide`, `cp_no_coincide`,
`rfc_inexistente` o en lista 69-B, **con corrección en un clic**.

### 8.4 Importar clientes 📐

CSV o XLSX con encabezados exactos y orden libre.

**El ensayo en seco es obligatorio**: primero se devuelve el reporte de errores
por fila **sin escribir nada**. Un archivo con 3 filas malas de 100 no escribe
ninguna. Después de importar, se encola la validación masiva sola.

### 8.5 Trasladar el padrón que ya existe 📐

Las 147 organizaciones con RFC **no se trasladaron automáticamente** al
expediente, y la decisión es deliberada: ninguna tiene régimen fiscal, que es
obligatorio, y darlas por altas las marcaría como expediente completo con datos
que el SAT rechazaría.

El traslado irá aparte, con reporte de incidencias y sin dar nada por bueno en
silencio.

---

## 9. Quién puede hacer qué

El sistema de permisos por módulo y nivel **ya existe y está en uso**: el módulo
se llama `clientes` y sus niveles son `ver`, `editar` y `administrar`. Lo que
está diseñado y no construido es el reparto de las acciones nuevas.

| Acción | Nivel | Estado |
|---|---|---|
| Ver el catálogo | `clientes:ver` | ✅ |
| Editar la ficha de la organización | `clientes:administrar` | ✅ |
| Editar datos comerciales | `clientes:editar` | 📐 |
| Editar el **bloque fiscal** | `clientes:administrar` | 📐 |
| Validar ante el SAT | `clientes:administrar` | 📐 |
| Importar | `clientes:administrar` | 📐 |

> El bloque fiscal exige un nivel más alto que el comercial **a propósito**: quien
> ajusta un descuento no debería poder cambiar el RFC con el que se factura.

---

## 10. El contrato de datos

### 10.1 Por qué no hay una tabla `cliente`

La entidad ya existía: **`crm_organizations`**, con las organizaciones del padrón
de SAE, su RFC y su domicilio desarmado nodo por nodo del SAT. Una tabla
`cliente` al lado habría partido el padrón en dos y obligado a mantener
sincronizadas dos verdades sobre la misma empresa — y la que se desincroniza es
siempre la que no se está mirando.

Lo que faltaba no era la entidad: era el expediente.

```
crm_organizations ──1:1── cliente_fiscal          el expediente que se timbra
                  ──1:1── cliente_comercial       crédito, descuentos, contabilidad
                  ──1:1── cliente_validacion_sat  el veredicto del SAT, como ESTADO
                  ──1:N── cliente_domicilio       fiscal, envío, facturación, sucursal
                  ──1:N── cliente_campo_libre     lo que cada empresa quiera añadir
```

Se separan porque **lo fiscal y lo comercial tienen dueños, ritmos y
consecuencias distintas**. Mezclados en una tabla ancha, un `update` de
descuentos toca la misma fila que el RFC, la misma auditoría y los mismos
permisos. Separados, facturación no necesita cargar el crédito, y `cliente_fiscal`
habla el vocabulario del SAT en vez del de la casa — que es lo que hace que quien
arme el XML no tenga que traducir nada.

### 10.2 Dónde vive cada cosa

| Tabla | Esquema | Por qué ahí |
|---|---|---|
| `crm_organizations`, `cliente_*` | `tenant_<slug>` | Datos de negocio, aislados por empresa |
| `sat_*` | `public` | Catálogos del SAT: públicos, idénticos para todos |

La regla de la casa es que ninguna tabla de negocio vive en `public`, para que
una consulta sin inquilino activo falle en vez de devolver datos ajenos. Los
catálogos no la rompen: **no contienen datos de nadie**. Y duplicarlos por
esquema sería insostenible — `c_CodigoPostal` trae ~95 000 renglones y
`c_Colonia` ~145 000; con veinte inquilinos, casi cinco millones de filas
idénticas que actualizar una por una.

### 10.3 `cliente_fiscal` → nodo CFDI

| Columna | Nodo CFDI 4.0 |
|---|---|
| `rfc` | `Receptor@Rfc` |
| `nombre_fiscal` | `Receptor@Nombre` |
| `regimen_fiscal` | `Receptor@RegimenFiscalReceptor` |
| `cp_fiscal` | `Receptor@DomicilioFiscalReceptor` |
| `pais_residencia` | `Receptor@ResidenciaFiscal` |
| `num_reg_id_trib` | `Receptor@NumRegIdTrib` |
| `uso_cfdi_default` | `Receptor@UsoCFDI` |
| `nombre_capturado` | — (trazabilidad) |
| `persona_tipo` | — (derivado del RFC) |
| `rol_fiscal` | — (decide qué se valida) |

### 10.4 Invariantes que garantiza la base

- **`(rfc, cp_fiscal)` es único** — y no `rfc` solo. Un mismo RFC dos veces es
  legítimo (matriz y sucursal); lo que no puede repetirse es el mismo
  contribuyente en el mismo domicilio fiscal, que ya es la ficha duplicada. Un
  índice sobre el RFC solo habría bloqueado el caso legítimo, que en un ERP es el
  más frecuente.
- **Un solo domicilio `fiscal` por cliente**, con índice único **parcial**
  (`WHERE tipo = 'fiscal'`). Parcial, para que quepan tantos de envío como haga
  falta. Índice y no disparador, porque un disparador es una regla que solo existe
  en producción y que ninguna prueba ve venir.
- **`cliente_validacion_sat_log` es append-only.** Ahí no se hace `update`.

### 10.5 Por qué no hay llaves foráneas a `sat_*`

Dos razones, ambas de peso:

1. El adaptador que aplica las migraciones por esquema quita la calificación
   `"public".` de toda FK que no apunte al plano de control, así que una FK a
   `sat_regimen_fiscal` acabaría apuntando a una tabla inexistente **dentro** del
   inquilino.
2. Y aunque se arreglara: los catálogos llegan vacíos. Una FK convertiría
   «todavía no puedo **validar** el régimen» en «no puedes dar de alta un
   cliente», que es un fallo mucho peor.

La integridad se comprueba en la capa de dominio, que sabe distinguir *inválido*
de *no verificable* y lo dice.

### 10.6 Contrato de la API 📐

```
GET    /api/clientes                       ?q=&estatus=&zona=&validacion=&page=
POST   /api/clientes
GET    /api/clientes/:id
PATCH  /api/clientes/:id
DELETE /api/clientes/:id                   baja lógica si tiene movimientos
POST   /api/clientes/:id/validar-sat
POST   /api/clientes/validar-sat/lote      devuelve job_id
GET    /api/clientes/validar-sat/lote/:job progreso + reporte
POST   /api/clientes/importar              ensayo en seco por omisión
GET    /api/clientes/exportar
GET    /api/sat/codigos-postales/:cp/colonias
GET    /api/sat/usos-cfdi?regimen=601      alimenta el selector filtrado
```

`POST` y `PATCH` devuelven **422 con errores por campo** —`{campo, codigo,
mensaje}`—, nunca un texto genérico, y con los códigos del SAT donde aplique para
que el mensaje sea accionable.

---

## 11. Los catálogos del SAT

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

**La matriz uso ↔ régimen no se escribe a mano. Nunca.** Se deriva de la columna
«Régimen Fiscal Receptor» de `c_UsoCFDI`, donde el SAT lista por cada uso los
regímenes que lo admiten. Escribirla a mano se equivoca —y el resultado es
justamente el `CFDI40158` que la tabla existe para evitar— y se queda vieja,
porque el SAT la cambia sin avisar.

**Las tablas existen y llegan vacías**, y eso es correcto: las migraciones crean
la forma, los datos se cargan desde los archivos oficiales del Anexo 20. No se
siembran valores «de referencia» porque **un catálogo fiscal a medias es peor que
uno vacío**: vacío, el sistema dice que no puede validar; a medias, valida mal y
con aplomo.

### Cómo se cargan ✅

Del Anexo 20 del SAT, hoja «catCFDI». Se descarga el XLS y se exporta cada hoja a
CSV con el nombre de su catálogo (`c_RegimenFiscal.csv`, `c_UsoCFDI.csv`…).

```bash
npm run sat:catalogos -- --dir ~/Descargas/catCFDI            # ENSAYO
npm run sat:catalogos -- --dir ~/Descargas/catCFDI --aplicar
```

**Ensayo por omisión**: sin `--aplicar` no escribe nada — lee, cuenta y avisa de
lo que no entiende. Los archivos que falten se saltan con un aviso; no hace falta
tenerlos todos.

Un catálogo se **reemplaza**, no se acumula: si el SAT quitó una clave, dejarla
la seguiría ofreciendo en altas nuevas.

**Lo que no entiende, lo dice** (regla 9 de `AGENTS.md`). Un uso que cita un
régimen inexistente, una colonia con un CP que no está, una columna que falta:
todo sale en el reporte. Y si falta la columna «Régimen Fiscal Receptor», lo dice
con todas las letras: la matriz no se puede derivar y el `CFDI40158` seguirá sin
comprobarse. No se inventa un «todos con todos», que parecería una comprobación
sin serlo.

`sat_catalogo` registra qué hay cargado, de qué archivo, con qué hash y en qué
versión, para que «¿contra qué catálogo se validó esta factura?» tenga respuesta
dentro del sistema y no dependa de la memoria de nadie.

**Vigencias:** un régimen dado de baja **no se borra**. Deja de ofrecerse en altas
nuevas y sigue resolviendo para los CFDI históricos que lo llevan; borrarlo
dejaría comprobantes ya timbrados apuntando a la nada.

---

## 12. Qué se comprueba, y dónde

`probe-clientes-fiscal.mts` — **sin base de datos**, en el trabajo rápido del CI.
Los catálogos entran como parámetro, que es por lo que `validarExpediente` los
recibe en vez de leerlos: **una regla fiscal que solo se puede probar levantando
Postgres es una regla que nadie prueba.**

```bash
npx tsx --tsconfig tsconfig.check.json probe-clientes-fiscal.mts
```

Cubre: RFC (forma, fecha, dígito verificador), normalización del nombre, la
matriz uso ↔ régimen, régimen contra tipo de persona, código postal, los dos RFC
genéricos, la herencia del CP de la matriz, y la caducidad del veredicto.

**El algoritmo del dígito verificador está medido, no supuesto:** se corrió contra
los 147 RFC reales del padrón y coincide en el **98,0 %**. Si estuviera mal, la
tasa rondaría el 9 % (1 entre 11 por azar). Los tres que no cuadran son captura
mala del padrón de SAE — justo lo que este módulo existe para encontrar.

Código relacionado:

```
src/lib/domain/fiscal.ts     RFC, CURP, normalización del nombre. PURO.
src/lib/domain/cliente.ts    el expediente completo. PURO.
src/lib/db/schema.ts         las tablas cliente_*
src/lib/db/platform.ts       los catálogos sat_*
```

Y el skill **`clientes`** (`.claude/skills/clientes/SKILL.md`) resume lo que hay
que saber antes de tocar cualquiera de ellos.

---

## 13. Lo que todavía no existe

Escrito aquí para que nadie lo dé por hecho al leer lo de arriba, y para que el
manual de usuario no documente pantallas inexistentes:

| Falta | Estado |
|---|---|
| `ValidadorFiscal` (PAC, portal masivo, mock) | Puerto descrito, adaptadores sin escribir |
| Cargador `npm run sat:catalogos` | ✅ **construido**; las tablas siguen vacías hasta que se corra con los archivos del SAT |
| Formulario del expediente fiscal | ✅ **construido**, en «Editar organización» |
| Formulario por pestañas completo | Sin construir (hoy son dos tarjetas: comercial y fiscal) |
| API REST de clientes | Sin construir |
| Importación / exportación CSV | Sin construir |
| Bloqueo por lista 69-B | La columna existe, nadie la lee |
| Traslado del padrón (`clientes:adoptar`) | Sin construir |
| Lectura del QR de la Constancia | Sin construir |

**Hoy se puede:** capturar el expediente fiscal desde «Editar organización» con
todas las reglas funcionando, ver su estado en la lista y en la ficha, y cargar
los catálogos del SAT.

**Hoy no se puede:** consultar al SAT. El semáforo no puede llegar a «Validado»
por ningún camino automático — solo cambiando el estado a mano en la base—,
porque el `ValidadorFiscal` no está escrito.
