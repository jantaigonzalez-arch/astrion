# Capa de inteligencia

El motor de ML del ERP. Vive aparte de Next.js porque es Python, y es Python
porque la taxonomía que sostiene —XGBoost, ARIMA, Isolation Forest,
programación entera mixta— no existe en TypeScript de forma honesta.

## Cómo se piensa

Toda petición pasa por la misma pregunta antes de que se toque un modelo:

1. **¿Qué quiere saber esta persona?** → `intents.py`, ocho intenciones cerradas.
2. **¿Cuál es el método más simple que lo contesta bien?** → seis escalones, de
   SQL a acción en el ERP.
3. **Solo entonces**, qué modelo o consulta se invoca.

La regla que lo gobierna: **nunca se usa aprendizaje automático por el hecho de
tenerlo disponible.** «¿Cuánto inventario tengo?» es un `SELECT`, y contestarlo
con un estimador es cambiar una cifra cierta por una aproximada.

## Los archivos

| archivo | qué es |
|---|---|
| `intents.py` | La taxonomía y la jerarquía de métodos. La ley de la capa. |
| `classify.py` | De una pregunta en español a intención y método. Por reglas. |
| `catalog.py` | Qué se puede preguntar en cada módulo. Anclas temporales. |
| `contracts.py` | El contrato con el ERP. Espejo de `src/lib/intelligence/contracts.ts`. |
| `data.py` | Postgres → Polars, con `search_path` por inquilino. |
| `automl/features.py` | Serie → matriz supervisada, sin mirar el futuro. |
| `automl/registry.py` | Familias de modelos y las líneas base a batir. |
| `automl/evaluate.py` | Partición temporal, medición y veredicto. |
| `automl/search.py` | La búsqueda. |
| `automl/project.py` | Del modelo a puntos futuros, con banda. |
| `main.py` | El borde HTTP. |

## Desarrollo

```bash
cd services/intelligence
uv venv --python cpython-3.12-macos-aarch64-none .venv   # nativo: ver nota
uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m pytest tests/ -q

# Con la base del ERP delante
set -a; . ../../.env.local; set +a
.venv/bin/python -m uvicorn app.main:app --port 8099 --reload
```

**Nota sobre el Python nativo en macOS ARM.** Si `uv` es el binario x86_64,
instala un Python x86_64 y Polars avisa de que le faltan instrucciones de CPU
—corre bajo Rosetta y puede caerse—. Hay que pedir el arm64 explícito, como
arriba.

## Lo que NO hace

**No guarda nada.** Lee el histórico, entrena, devuelve el modelo serializado y
se olvida. El ERP lo guarda en el esquema del inquilino. Es lo que mantiene la
promesa que el producto ya le hace al cliente: *tus modelos viven donde viven
tus datos, y un respaldo de tu base se los lleva consigo.*

**No escribe en el ERP.** La taxonomía tiene una intención `ACTION` y esta capa
la clasifica, pero ejecutarla es del ERP, detrás de sus permisos. Un servicio de
modelos con permiso de escritura sobre la base del cliente es un riesgo que no
compra nada.

**No se expone.** Sin puerto publicado: solo lo alcanzan los contenedores de la
red interna, y su único cliente es `web`.

## Estado

Implementado: clasificación de intención · catálogo por módulos · perfilado ·
AutoML de pronóstico con cinco familias, destendenciado y líneas base fuertes ·
proyección con banda.

Declarado y sin implementar: regresión y clasificación sobre panel (el contrato
las admite y `/entrenar` devuelve 501 con el motivo), detección de anomalías,
optimización, simulación. `IMPLEMENTED` en `intents.py` es la lista viva, y por
eso una pregunta de optimización se clasifica bien y responde
`supported: false` en vez de contestarse con lo que haya a mano.

## Apache Iceberg

Evaluado y **no adoptado todavía**, a conciencia. Iceberg aporta viaje en el
tiempo, evolución de esquema y ACID sobre almacenamiento de objetos, y para eso
necesita un catálogo (REST, Nessie o Glue) que hay que operar. Con 14 mil filas
por inquilino sería infraestructura sin trabajo que hacer, y el lago parquet ya
da la reproducibilidad que hace falta.

El umbral concreto a partir del cual sí gana: cuando el lago pase de unos
cientos de millones de filas agregadas, cuando haga falta consultar VARIOS
inquilinos a la vez —hoy imposible por diseño— o cuando el esquema de los
conjuntos congelados empiece a cambiar entre versiones y haga falta leer los
viejos con el lector nuevo. Ninguna de las tres se cumple.

Y una corrección sobre **Koalas**: está descontinuado. Se absorbió en
`pyspark.pandas` con Spark 3.2, así que recomendarlo hoy sería recomendar una
API muerta. Su sustituto real a este tamaño es Polars —que además es el mismo
motor que ya usa el lado de Node— y al tamaño donde Spark se justificaría, este
ERP tendría problemas más urgentes que la biblioteca de dataframes.
