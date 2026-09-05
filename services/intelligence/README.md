# Capa de inteligencia

El motor de ML del ERP. Vive aparte de Next.js porque es Python, y es Python
porque la taxonomía que sostiene —XGBoost, ARIMA, Isolation Forest,
programación entera mixta— no existe en TypeScript de forma honesta.

Su cliente es `src/lib/intelligence/` en el ERP. El panorama de las dos capas
—Inteligencia *produce*, Análisis *sirve*— está en el
[README de la raíz](../../README.md#capa-de-inteligencia); aquí está el detalle
del motor.

---

## Cómo se piensa

Toda petición pasa por la misma pregunta antes de que se toque un modelo:

1. **¿Qué quiere saber esta persona?** → `intents.py`, ocho intenciones cerradas.
2. **¿Cuál es el método más simple que lo contesta bien?** → seis escalones, de
   SQL a acción en el ERP.
3. **Solo entonces**, qué modelo o consulta se invoca.

La regla que lo gobierna: **nunca se usa aprendizaje automático por el hecho de
tenerlo disponible.** «¿Cuánto inventario tengo?» es un `SELECT`, y contestarlo
con un estimador es cambiar una cifra cierta por una aproximada.

### Las ocho intenciones y su suelo

Cada intención declara el escalón **mínimo** que la contesta. Mínimo y no fijo:
una recomendación puede necesitar subir —«cuánto debería pedir» arranca en
optimización y lleva un pronóstico debajo— pero nunca puede bajar de ahí sin
dejar de contestar la pregunta. Es el suelo que impide que una recomendación se
resuelva con un promedio.

| intención | qué pide | suelo | ¿se sabe hacer hoy? |
|---|---|---|---|
| `QUERY` | recuperar lo registrado. No es una predicción | L1 determinista | ✅ |
| `DIAGNOSIS` | entender **por qué** pasó algo | L2 estadístico | ✅ |
| `ANOMALY` | qué se está comportando raro | L2 estadístico | ✅ |
| `FORECAST` | qué va a pasar. La razón de ser de la capa | L3 aprendizaje | ✅ |
| `RECOMMENDATION` | qué **conviene** hacer | L3 aprendizaje | ✅ |
| `OPTIMIZATION` | la mejor decisión bajo restricciones | L4 optimización | ❌ |
| `SIMULATION` | qué pasaría si cambio esta variable | L5 simulación | ❌ |
| `ACTION` | ejecutar una operación en el ERP | L6 acción | ❌ (por diseño) |

Cuando una pregunta pide un escalón que no está en `IMPLEMENTED`, la capa
responde `supported: false` **con el motivo**, y no la degrada al método más
pobre que sí sabe hacer. Una capa que degrada en silencio es exactamente cómo se
pierde la confianza en ella: el usuario recibe un número, no sabe que es de otra
clase, y lo trata igual que a los buenos.

Cuando una pregunta trae varias intenciones, **manda la más exigente**.
Resolverla por la parte fácil dejaría sin contestar la que importa.

`Horizon.PAST` merece una nota: no es un horizonte degenerado, es la marca de
que la pregunta **no necesita modelo**. Distinguirlo evita entrenar para
contestar algo que ya ocurrió y está registrado.

---

## El recorrido de una pregunta

```
POST /clasificar   "¿cuánto voy a facturar el mes que viene?"
      │
      ├─ normalizar        minúsculas, sin acentos
      ├─ señales           pesos por intención, dominio y horizonte
      ├─ floor_for()       el escalón mínimo del conjunto
      └─ is_supported()    ¿lo sabemos hacer?  →  sí / supported:false / clarification_required

POST /entrenar     una Serie del catálogo
      │
      ├─ data.py           SET LOCAL search_path → esquema de ESA empresa
      ├─ profile.py        ¿hay datos para esto? avisos en lenguaje de negocio
      ├─ features.py       serie → matriz supervisada, sin mirar el futuro
      ├─ split_temporal()  entrenar 55 % · elegir 15 % · medir 30 %
      ├─ search.py         familias que alcanzan el mínimo de filas compiten
      │                      elección SOLO sobre el tramo de elegir
      ├─ evaluate.py       el tramo de medir se estrena con el ganador decidido
      ├─ verdict_for()     ¿le ganó a la respuesta ingenua? approved sí/no
      └─ reajuste con TODO el histórico → modelo serializado al ERP

POST /pronosticar  modelo + periodos
      └─ project.py        recursivo, con banda que se ensancha
```

---

## La invariante: ninguna columna mira el futuro

> Toda columna de la matriz, para la fila del periodo `t`, se calcula
> **exclusivamente** con periodos anteriores a `t`.

Es la única defensa que de verdad importa, y no se puede verificar leyendo el
modelo. Por eso se concentra en un solo archivo pequeño —`automl/features.py`—
y se comprueba con un experimento, no con una revisión.

**El fallo que evita** es concreto y frecuente: una media móvil que incluye el
propio periodo. Sale un modelo con error bajísimo en el *backtest* que se
desploma el primer día en producción, y nadie encuentra el motivo porque ninguna
columna se ve sospechosa — el rasgo se calcula del propio objetivo,
correctamente, un instante demasiado tarde.

En el código son estos dos caracteres:

```python
pasado = pl.col("value").shift(1)          # ← el shift va ANTES de la ventana
pasado.rolling_mean(window_size=w)          # con la ventana primero, el promedio
                                            # de 3 meses incluye el mes a predecir
```

### Cómo se comprueba

`tests/test_features.py` **no lee el código: experimenta.** Toma una serie,
corrompe el valor de todos los periodos posteriores a uno dado (`×1000 + 7`) y
exige que ninguna columna de ninguna fila anterior cambie ni un decimal.

Y para que la prueba no sea un sello de goma, corre también contra una columna
**deliberadamente fugada** —la misma media móvil sin el desplazamiento— que
tiene que salir reprobada. *Una prueba que no puede fallar no prueba nada.*

### Por qué estas columnas

Una serie de negocio tiene tres componentes que hay que poder separar:

| bloque | columnas | para qué |
|---|---|---|
| **Nivel** | `lag_1..12`, `media_3/6/12`, `desv_3/6/12`, `mediana_12` | dónde está la serie ahora |
| **Tendencia** | `t` (índice entero), `delta_1`, `delta_anual` | lo que permite **extrapolar** |
| **Estacionalidad** | `mes`, `trimestre`, `semana`, `dia_semana` | diciembre no se parece a enero, y eso es calendario, no ruido |

Los rezagos por grano: mensual `1,2,3,6,12` —el 12 es el mismo mes del año
anterior, que en un negocio con cierre de ejercicio es la comparación que de
verdad usa la gente, y el 6 está por el semestre, que en presupuesto público
manda—; semanal `1,2,3,4,8,52`; diario `1,2,3,7,14,28,365`.

**`t` es la columna crítica.** Es lo único de la matriz que puede tomar valores
nunca vistos en el entrenamiento, y por eso lo único que permite extrapolar. Sin
él, todo modelo queda encerrado en el rango histórico — que es exactamente por
qué un catálogo basado en medianas por grupo no pudo nunca pronosticar una serie
que crece.

**`value` no es una señal** y está excluido a propósito: ya está representado por
el `lag_1` de la fila siguiente. Dejarlo dentro duplicaría la información y haría
imposible razonar sobre qué vio el modelo.

**La pérdida de filas no se disimula.** Se descartan las primeras —rezagos largos
nulos— y las últimas —el objetivo cae fuera del histórico—: con 119 meses y
rezago de 12, se entrena con 106.

---

## El examen

Todo lo que hace creíble a un número de esta capa vive en `automl/evaluate.py`,
y **nada de ello depende de qué modelo se esté evaluando**. Que esté separado
del buscador es lo que permite añadir familias nuevas sin relajar una sola
defensa.

### La partición es en tres, y temporal

```
│───────── entrenar 55 % ─────────│── elegir 15 % ──│──── medir 30 % ────│
                                                      ↑
                                        se toca UNA vez, con el ganador
                                        ya decidido
```

No es purismo. Con cinco familias y sus rejillas se prueban decenas de
candidatos, y si el ganador se eligiera mirando el tramo de prueba, la
probabilidad de que alguno acierte **por azar** deja de ser teórica.

El corte es **temporal, nunca aleatorio**. Un *split* al azar sobre una serie
deja que el modelo se entrene con el futuro y produce una métrica excelente que
se desploma en producción.

Mínimos por tramo: 8 casos para elegir, 12 para medir. Por debajo, el resultado
es anécdota.

### La línea base es la más fuerte, no la más cómoda

Aquí está corregido el fallo más grave del laboratorio anterior, que usaba
«predecir siempre la mediana global». Contra una serie que crece 2,7× en diez
años, esa línea base es tan mala que **cualquier** modelo la supera — y una
mejora del 40 % sobre ella podía seguir siendo un pronóstico inútil.

El rival es la **más fuerte** de las respuestas ingenuas, elegida sobre el propio
tramo de entrenamiento:

| línea base | qué predice |
|---|---|
| `naive` | el valor del periodo anterior — la respuesta de quien no tiene modelo |
| `seasonal_naive` | el mismo periodo del ciclo anterior |
| `drift` | el último valor más la pendiente media del histórico |

Si un modelo no le gana al «igual que el mes pasado», no hay nada que promover.

### El veredicto

Dos condiciones, medidas **contra el mismo rival**:

1. el error baja **≥ 5 %** respecto de la línea base, **y**
2. hay evidencia de que cambia decisiones: los aciertos dentro de la tolerancia
   suben **≥ 5 puntos** sobre la línea base, **o** el error baja tanto —**≥ 20 %**—
   que el umbral se queda corto para medirlo.

**Por qué la segunda condición admite dos evidencias.** «Aciertos dentro del
margen» es una métrica de *umbral*, y los umbrales son ciegos a lo que no cruza
la línea. Medido en cuentas por pagar: el modelo bajó el error un **29,8 %** y
los aciertos quedaron en 42 % contra 42 %, porque **42 % era el techo del
fenómeno** con ese margen. Rechazarlo ahí habría sido rechazar por no poder
medir.

**Por qué el listón de aciertos no es absoluto.** La versión anterior exigía
«acertar el 50 % de las veces dentro del margen», un número fijo. Estaba mal, y
se demostró midiendo: un fenómeno cuya dispersión propia es alta tiene un
**techo** de aciertos que ningún modelo pasa —con un coeficiente de variación de
0,5, el techo dentro de ±25 % ronda el 41 %—. Exigir un 50 % ahí es exigir lo
imposible y culpar al modelo.

Peor todavía, era **incoherente**: el error se juzgaba contra una línea base y
los aciertos contra una constante, así que dos modelos que aportaban lo mismo
—+8 y +9 puntos sobre no tener modelo— recibían veredictos opuestos según lo
disperso que fuera el fenómeno, no según lo bueno que fuera el modelo.

Con la línea base ya por encima del **95 %** de aciertos la condición se relaja:
no quedan puntos que ganar, y exigirlos sería exigir lo imposible otra vez.

---

## Las familias que compiten

| familia | etiqueta | filas mínimas | ¿extrapola? | ¿se explica? |
|---|---|---|---|---|
| `ridge` | Regresión regularizada | 24 | ✅ | ✅ |
| `huber` | Regresión robusta | 24 | ✅ | ✅ |
| `gradient_boosting` | Árboles con refuerzo | 48 | ❌ | ❌ |
| `random_forest` | Bosque aleatorio | 60 | ❌ | ❌ |
| `xgboost` | XGBoost | 72 | ❌ | ❌ |

Más la variante **destendenciada**, que quita la tendencia lineal, deja que el
modelo aprenda el residuo y se la devuelve al predecir. Es lo que le permite a un
árbol participar en una serie creciente.

**El orden no es estético: en el desempate gana el primero.** Un bosque que solo
*iguala* a la media móvil no merece el puesto — añade piezas que mantener, un
artefacto más grande que guardar y una cifra más difícil de explicar en una
junta, a cambio de nada. Que la sencillez desempate sea una **regla del código** y
no del criterio de quien mira la tabla es lo que impide que gane el modelo que
más ilusión daba.

**`min_rows` se comprueba contra el tramo de entrenamiento**, no contra el total.
Un modelo que necesita 200 filas y ve 130 no está en condiciones de competir: no
pierde limpiamente, memoriza, y con un tramo de prueba chico puede ganar por
suerte.

**`extrapolates` no es documentación, se usa.** Los modelos de árbol parten por
umbrales, así que su predicción está acotada por los valores que vieron — da
igual cuánta señal de tendencia se les dé. La búsqueda lo mira para avisar cuando
el ganador no sabe extrapolar una serie que sí crece.

**`explains` importa de verdad en un ERP**: a veces el negocio necesita un número
que pueda defender, aunque otro modelo acierte un punto más.

Un detalle del relleno de nulos: los que quedan son de rezagos largos en filas
tempranas y se rellenan con la **mediana** de la columna, no con cero. Un cero en
«media de 12 meses» dice *«no hubo negocio»*, y eso es falso — dice *«todavía no
había doce meses»*.

Al final se guarda el modelo **reajustado con todo el histórico**: el corte
servía para medir, no para producir el que va a predecir mañana.

---

## La proyección y su banda

**Directo al medir, recursivo al proyectar**, y la asimetría es deliberada.

El examen entrena **un modelo por horizonte** —pronóstico directo— para que cada
horizonte se mida contra la realidad y no contra las predicciones del propio
modelo. El recursivo alimenta sus propias salidas como entrada y acumula error:
a tres periodos ya está prediciendo sobre una historia que se inventó él.

Para **proyectar**, en cambio, hace falta una fila por periodo futuro, y esa fila
necesita los rezagos de periodos que todavía no han ocurrido. No hay
alternativa: se alimentan con lo predicho. La consecuencia se dice en voz alta en
vez de esconderse — **la banda se ensancha con la distancia**. El periodo
siguiente lleva la incertidumbre del modelo; el sexto lleva además la de los
cinco pronósticos que tuvo que usar como si fueran datos.

**La banda sale del error absoluto en el tramo de prueba, no de un supuesto de
normalidad.** Es lo honesto con series de negocio: tienen cola derecha —el mes
del pedido enorme— y una banda gaussiana la subestima justo donde más importa.

---

## El perfilado, que se corre siempre

`automl/profile.py` se ejecuta **aunque el entrenamiento salga bien**, y su
salida se le enseña al usuario. La razón: **la mitad de los fracasos de un modelo
no son del modelo.** Son un objetivo constante, un histórico de seis casos, una
columna vacía en el 99 % de las filas o un mes en curso contado como mes
completo.

Todo eso se ve en un segundo, y sin verlo el usuario recibe un veredicto negativo
sin causa —«no alcanza»— y concluye que el ERP no sirve para esto.

Los avisos están escritos **para quien opera el negocio**, no para quien entrena
modelos: dicen qué arreglar en el registro del dato, no qué hiperparámetro mover.

> «No hay ni un periodo con datos. La consulta es correcta y el histórico está
> vacío: es un problema de captura, no de modelo.»

---

## El catálogo, o por qué no se puede configurar un modelo tramposo

`catalog.py` es la razón por la que un usuario puede armar su propia pregunta sin
poder armar una que haga trampa. La libertad se da donde es inofensiva —qué
módulo, qué responder, con qué señales, con cuánto margen— y **lo peligroso se
queda escrito aquí**, una vez, por quien conoce el esquema:

- **El ancla temporal** de cada sujeto, que define qué cuenta como «el pasado» de
  un caso. Es el punto exacto por donde se cuela la fuga, y por eso no se elige
  desde la pantalla — no se elige nunca.
- **Qué señales existen.** Solo entran columnas ya fijadas en el instante del
  ancla. El usuario no puede entrenar con el estado final del ticket porque
  `status` **no está en el catálogo**, no porque haya un aviso pidiéndole que no
  lo haga.

El criterio para agregar una señal es una sola pregunta: **¿su valor es el mismo
en el momento del ancla que hoy?** Si la respuesta es «depende», no entra.
`assigned_to_id` es el ejemplo de manual —parece inocente, se asigna minutos
después de crear el ticket y se reasigna a mitad del servicio— y por eso está
deliberadamente ausente.

### Dos formas de pregunta, y no una

| tipo | un caso es | para qué | tareas |
|---|---|---|---|
| `Sujeto` | una entidad en un momento | «¿cuántas horas lleva **este** ticket?» | regresión, clasificación |
| `Serie` | un periodo | «¿cuánto se factura el mes que viene?» | pronóstico, y con él la **extrapolación** |

El laboratorio anterior solo sabía la primera. Servía para las horas de un ticket
y los días de una refacción, y no servía para nada que fuera una serie en el
tiempo — lo que dejó «cuánto se va a facturar el mes que viene» sin poder
contestarse durante todo su desarrollo, porque **no había forma de expresar una
tendencia**.

Que sean dos tipos y no un parámetro es deliberado: exigen datos distintos, se
evalúan distinto —una serie se corta por fecha, un panel por entidad y fecha— y
admiten modelos que no se parecen. Unificarlos habría producido una abstracción
que miente sobre las dos.

Sujetos hoy: `ticket`, `equipment_service`, `part_consumption`, `deal`.
Series hoy: `payables_monthly`, `service_demand_monthly`, `service_hours_monthly`,
`parts_demand_monthly`, `sales_won_monthly`, `deals_created_monthly`.

---

## La clasificación es por reglas, y es a propósito

Por la misma regla que gobierna toda la capa: no se usa el método caro cuando el
barato contesta bien. Sería incoherente que el clasificador —cuyo trabajo es
impedir que se use ML sin necesidad— fuera él mismo una llamada a un LLM por cada
pregunta.

Y aquí las reglas ganan de verdad, no por ahorro:

- **El espacio es cerrado.** Ocho intenciones, diecisiete dominios. No es
  comprensión de lenguaje abierto, es **enrutado**.
- **Tiene que ser determinista.** La misma pregunta debe clasificar igual hoy y
  en marzo, o el usuario ve que su tablero cambió de método sin que él tocara
  nada.
- **Tiene que poder explicarse.** `Classification.why` lleva las señales que
  dispararon. Con un LLM detrás, ese campo sería una racionalización.
- **No puede depender de una red ajena.** Una clasificación que falla porque un
  proveedor está caído convierte toda la capa en opcional.

Cuando las reglas no alcanzan, la salida correcta **no es adivinar**: es
`clarification_required`, que le devuelve la pregunta al usuario. *Un clasificador
que siempre responde algo es un clasificador del que no te puedes fiar cuando
responde.*

El enganche para un LLM queda declarado en `disambiguate()` y sin implementar: el
día que haga falta, entra donde las reglas se declaran vencidas, no antes.

Detalle que parece menor y no lo es: se normaliza a minúsculas **y sin acentos**.
Sin eso, «cuánto» y «cuanto» son dos palabras distintas, y en un ERP mexicano la
mitad de las preguntas se teclean sin acentos. Es el fallo más tonto y más
frecuente de un clasificador por reglas en español.

---

## El aislamiento entre empresas

Cada empresa vive en su propio esquema de Postgres, y `data.py` fija
`search_path` a ese esquema **y nada más**.

No es una comodidad para no escribir el prefijo: las consultas del catálogo
nombran tablas **sin esquema**, así que una consulta compilada para una empresa
es *literalmente incapaz* de leer la de otra. No hay que acordarse de filtrar por
inquilino porque no existe forma de nombrar el esquema ajeno.

```python
cur.execute(f"set local search_path to {esquema}")
```

**`SET LOCAL` y no `SET`:** se deshace al terminar la transacción, así que una
conexión devuelta al pool no puede llevarse el esquema de la empresa anterior.
Ese fallo —una conexión reutilizada con el `search_path` de otro inquilino— es de
los que **no dan error: dan los datos equivocados**.

Y el nombre del esquema se **valida** en vez de confiarse: llega por HTTP desde el
ERP y acaba interpolado en un `SET LOCAL`, que no admite parámetros. Un *slug*
con una comilla dentro sería inyección directa.

---

## Por qué Polars

**Mismo motor Rust que el lado de Node** (`nodejs-polars`), mismo parquet, mismas
semánticas de ventana. Los dos extremos del sistema hablan del mismo dataframe, y
eso es lo que evita que el conjunto con el que se entrena y el que se sirve se
separen sin que nadie lo note.

Y una nota honesta sobre velocidad: **a este tamaño Polars no es más rápido que
aritmética a mano** —se midió, y pierde por *marshalling* en conjuntos de cientos
de filas—. Entra por la **forma** de las expresiones (ventanas por entidad,
desplazamientos, agregados temporales) y porque es el mismo motor a los dos
lados. Defenderlo por velocidad sería falso.

---

## El borde HTTP

| ruta | qué hace | presupuesto del cliente |
|---|---|---|
| `GET /salud` | healthcheck del contenedor | 4 s |
| `POST /clasificar` | pregunta en español → intención + método + `why` | 4 s |
| `GET /catalogo` | qué se puede preguntar en cada módulo | 4 s |
| `GET /perfil/{tenant}/{serie_id}` | perfilado de la serie | 15 s |
| `POST /entrenar` | AutoML completo → modelo serializado | 180 s |
| `POST /pronosticar` | proyección con banda | 15 s |

Los presupuestos los impone el cliente TypeScript, no el servicio. El detalle
está en `src/lib/intelligence/client.ts`.

`contracts.py` es **espejo** de `src/lib/intelligence/contracts.ts`. Si cambia
uno, cambia el otro: están enfrentados a propósito para que la divergencia se vea
al leerlos en paralelo, porque no hay compilador que la atrape. Quien valida de
verdad es Pydantic, de este lado.

**La autenticación es de red y no de token** porque el único cliente es el propio
ERP. El día que haya otro, hará falta un token y esta frase sobra.

---

## Los archivos

| archivo | qué es |
|---|---|
| `intents.py` | La taxonomía y la jerarquía de métodos. **La ley de la capa.** |
| `classify.py` | De una pregunta en español a intención y método. Por reglas. |
| `catalog.py` | Qué se puede preguntar en cada módulo. Anclas temporales. |
| `contracts.py` | El contrato con el ERP. Espejo de `src/lib/intelligence/contracts.ts`. |
| `data.py` | Postgres → Polars, con `search_path` por inquilino. |
| `automl/features.py` | Serie → matriz supervisada, sin mirar el futuro. |
| `automl/profile.py` | Qué hay en los datos, antes de entrenar con ellos. |
| `automl/registry.py` | Familias de modelos y las líneas base a batir. |
| `automl/evaluate.py` | Partición temporal, medición y veredicto. |
| `automl/search.py` | La búsqueda. |
| `automl/project.py` | Del modelo a puntos futuros, con banda. |
| `main.py` | El borde HTTP. |

---

## Desarrollo

El entorno virtual va **fuera del repositorio**, y no es preferencia:

```bash
VENV=~/.venvs/astraion-intelligence
uv venv --python cpython-3.12-macos-aarch64-none "$VENV"
uv pip install --python "$VENV/bin/python" -e ".[dev]"

cd services/intelligence
"$VENV/bin/python" -m pytest tests/ -q

# Con la base del ERP delante
set -a; . ../../.env.local; set +a
"$VENV/bin/python" -m uvicorn app.main:app --port 8099 --reload
```

**Por qué fuera del repositorio.** Un `.venv` dentro del proyecto tiene un
symlink a `python3` que apunta al intérprete gestionado por `uv`, es decir fuera
de la raíz del proyecto — y eso hace **entrar en pánico a Turbopack** al
construir el ERP, con un error que no menciona Python por ningún lado
(`Symlink … points out of the filesystem root`, colgando de `src/lib/uploads.ts`).
Ignorarlo en `.gitignore` no alcanza: Turbopack recorre el disco, no el índice de
git. Fuera del árbol, el problema no existe.

**Nota sobre el Python nativo en macOS ARM.** Si `uv` es el binario x86_64 instala
un Python x86_64, y entonces Polars avisa de que le faltan instrucciones de CPU
—corre bajo Rosetta y puede caerse—. Hay que pedir el arm64 explícito, como
arriba.

**Al tocar `features.py`, corré `tests/test_features.py`.** Es la prueba que
sostiene la invariante, y es la única que no se puede sustituir por leer el
diff con atención.

---

## Lo que NO hace

**No guarda nada.** Lee el histórico, entrena, devuelve el modelo serializado y
se olvida. El ERP lo guarda en el esquema del inquilino. Es lo que mantiene la
promesa que el producto ya le hace al cliente: *tus modelos viven donde viven tus
datos, y un respaldo de tu base se los lleva consigo.*

**No escribe en el ERP.** La taxonomía tiene una intención `ACTION` y esta capa la
clasifica, pero ejecutarla es del ERP, detrás de sus permisos. Un servicio de
modelos con permiso de escritura sobre la base del cliente es un riesgo que no
compra nada.

**No se expone.** Sin puerto publicado: solo lo alcanzan los contenedores de la
red interna, y su único cliente es `web`.

---

## Estado

Implementado: clasificación de intención · catálogo por módulos · perfilado ·
AutoML de pronóstico con cinco familias, destendenciado y líneas base fuertes ·
proyección con banda.

Declarado y sin implementar: regresión y clasificación sobre panel (el contrato
las admite y `/entrenar` devuelve 501 con el motivo), detección de anomalías,
optimización, simulación. `IMPLEMENTED` en `intents.py` es la lista viva, y por
eso una pregunta de optimización se clasifica bien y responde `supported: false`
en vez de contestarse con lo que haya a mano.

---

## Apache Iceberg

Evaluado y **no adoptado todavía**, a conciencia. Iceberg aporta viaje en el
tiempo, evolución de esquema y ACID sobre almacenamiento de objetos, y para eso
necesita un catálogo (REST, Nessie o Glue) que hay que operar. Con 14 mil filas
por inquilino sería infraestructura sin trabajo que hacer, y el lago parquet ya
da la reproducibilidad que hace falta.

El umbral concreto a partir del cual sí gana: cuando el lago pase de unos cientos
de millones de filas agregadas, cuando haga falta consultar VARIOS inquilinos a
la vez —hoy imposible por diseño— o cuando el esquema de los conjuntos congelados
empiece a cambiar entre versiones y haga falta leer los viejos con el lector
nuevo. Ninguna de las tres se cumple.

Y una corrección sobre **Koalas**: está descontinuado. Se absorbió en
`pyspark.pandas` con Spark 3.2, así que recomendarlo hoy sería recomendar una API
muerta. Su sustituto real a este tamaño es Polars —que además es el mismo motor
que ya usa el lado de Node— y al tamaño donde Spark se justificaría, este ERP
tendría problemas más urgentes que la biblioteca de dataframes.
