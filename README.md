# Evoelution — Sitio web + Portal

Nueva plataforma web de Evoelution: sitio corporativo bilingüe (ES/EN), panel de
administración y sistema de tickets de soporte. Construido con lo último del
ecosistema Next.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack, Server Actions)
- **Tailwind CSS 4** + tokens OKLCH (modo claro/oscuro) + **Motion** (animaciones)
- **next-intl 4** — i18n español/inglés (`localePrefix: as-needed`, español por defecto)
- **Auth.js v5** (credenciales + JWT, roles: `admin` / `agent` / `client`)
- **Drizzle ORM** + **PostgreSQL** (multiempresa: un esquema por inquilino)
- **Zod** para validación
- **Python 3.12 + FastAPI** — el motor de la capa de inteligencia, en un
  contenedor aparte (scikit-learn, XGBoost, statsmodels)
- **Polars** a los dos lados — `nodejs-polars` en Node y `polars` en Python:
  mismo motor Rust, mismo parquet

## Arranque rápido

```bash
# 1. Node (una vez)
nvm install --lts && nvm use --lts

# 2. Dependencias
npm install

# 3. Variables de entorno
cp .env.example .env.local        # define DATABASE_URL y AUTH_SECRET
npx auth secret                   # genera AUTH_SECRET

# 4. Base de datos (requiere Postgres)
npm run db:migrate                # plano de control (public)
npx tsx scripts/tenant.ts migrate # esquema de cada empresa
npm run db:seed                   # datos demo + usuarios

# 5. Desarrollo
npm run dev                       # http://localhost:3000
```

> `db:push` sincroniza por diferencia, sin historial: sirve para tantear un
> cambio de schema, nunca para poner una base al día. Lo que corre en el
> servidor es `db:migrate`, así que es lo que hay que correr aquí.

## Entornos: dónde estás parado

Este proyecto **está en producción**, con clientes dentro. Hay dos entornos y
uno solo tiene datos reales:

| | DEV (tu máquina) | PROD (Hetzner) |
|---|---|---|
| Se llega por | `astraion.test:3002` | https://2-29-3-213.sslip.io |
| Datos | copia de producción, desarmada | los de verdad |
| Se distingue porque | el comando NO lleva `ssh` | lleva `ssh astrion-srv` o `docker compose` |

```bash
npm run sync:prod      # trae producción a local (solo lectura allá) y ensaya
                       # encima las migraciones pendientes
npm run deploy:prod    # lleva a producción lo que ya funcionó aquí
```

Cómo se pasa de uno a otro, qué desarma la sincronización y por qué, y qué
hacer si un despliegue sale mal: **[`docs/ENTORNOS.md`](docs/ENTORNOS.md)**.
Las reglas en versión corta, para agentes, en [`AGENTS.md`](AGENTS.md).

> El sitio público y el login funcionan **sin** base de datos. El formulario de
> contacto degrada con elegancia (acepta el lead sin persistir) hasta configurar
> `DATABASE_URL`. El portal (dashboard/tickets/admin) requiere Postgres + seed.

### Usuarios demo (tras `db:seed`)

| Rol    | Correo                  | Contraseña   |
| ------ | ----------------------- | ------------ |
| Admin  | admin@evoelution.com    | `Admin123!`  |
| Agente | agente@evoelution.com   | `Agente123!` |
| Cliente| cliente@lab.com         | `Cliente123!`|

## Estructura

```
src/
├── app/[locale]/
│   ├── (marketing)/         # sitio público: home, nosotros, servicios,
│   │                        #   productos, marcas, contacto
│   └── (portal)/
│       ├── login/           # inicio de sesión
│       └── (app)/           # área autenticada (guard de sesión + sidebar)
│           ├── dashboard/   # resumen (cliente y staff)
│           ├── tickets/     # lista, nuevo, detalle + comentarios
│           └── admin/       # cola de tickets, leads, usuarios, catálogo
│                            #   (guard de rol: solo agent/admin)
├── components/
│   ├── marketing/           # hero, stats, servicios, cromatograma, etc.
│   ├── portal/              # sidebar, topbar, formularios, badges
│   ├── shared/              # logo, tema, switcher de idioma
│   └── ui/                  # primitivos (button, input, card, badge…)
├── lib/
│   ├── db/                  # schema Drizzle + cliente
│   ├── auth.ts              # Auth.js
│   ├── tenancy/             # contexto de inquilino: qué empresa y con qué
│   │                        #   conexión (aislamiento por esquema)
│   ├── actions/             # server actions (leads, tickets)
│   ├── data/                # consultas (server-only)
│   ├── intelligence/        # PRODUCE — cliente del motor, contrato,
│   │                        #   preguntas y modelos, y la frontera
│   ├── ml/                  # SIRVE — análisis, bloques, colocaciones,
│   │                        #   tableros
│   ├── analytics/           # el lago: extractor incremental → parquet
│   └── tickets.ts           # constantes/labels/SLA (cliente+servidor)
├── i18n/                    # routing, request, navigation
└── messages/               # es.json, en.json

services/
└── intelligence/            # el motor, en Python. Contenedor aparte, sin
                             #   puerto publicado. README propio.
```

## Sistema de tickets

- Folio legible `EVO-000123`, categorías, prioridad y estados
  (`open → in_progress → waiting → resolved → closed`).
- **SLA de primera respuesta < 2 h** (según la promesa del sitio): se calcula
  `slaDueAt` al crear y se marca `firstRespondedAt` cuando responde el staff.
- Hilo de comentarios con **notas internas** (solo staff).
- El staff cambia estado y asigna; el cliente solo ve sus propios tickets.

## Capa de inteligencia

La parte del sistema que **no enseña lo que alguien capturó**. El resto del ERP
muestra un ticket, una factura, un contrato: cosas que una persona escribió.
Aquí se producen números que nadie escribió.

Esa diferencia gobierna todo el diseño. Un dato equivocado en un ticket se
corrige y se acabó; un pronóstico equivocado se convierte en una compra que no
hacía falta o en un técnico que no se contrató. **La honestidad del número es el
producto**, no una cualidad deseable del número.

### El mapa en una imagen

```
NAVEGADOR
    │
    ▼
NEXT.JS ───────────────────────────────────────────────────────────────┐
                                                                       │
  ANÁLISIS  (lib/ml/)               INTELIGENCIA  (lib/intelligence/)  │
  sirve lo producido                produce                            │
                                                                       │
  insights.ts      analyses.ts      client.ts     ← borde HTTP         │
  placements.ts    dashboards.ts    questions.ts  ← lo que persiste    │
  blocks-types.ts  formas.ts        contracts.ts  ← el protocolo       │
         ▲                                │                            │
         └──── serving.ts ────────────────┘   LA FRONTERA              │
                                                                       │
└────────────────────┬─────────────────────────────────────────────────┘
                     │  HTTP, red interna, sin puerto público
                     ▼
                     SERVICIO DE INTELIGENCIA  (services/intelligence/, Python)
                     intents · classify · catalog · automl · main
                     │
                     ▼
                     POSTGRES — search_path = esquema de ESA empresa
```

Hay **dos capas y una frontera**, y la separación es deliberada:

| | qué hace | dónde vive |
|---|---|---|
| **Inteligencia** | *Produce.* Clasifica la intención, busca el modelo, lo mide contra el futuro y emite el pronóstico. | `lib/intelligence/` + el servicio Python |
| **Análisis** | *Sirve.* Coloca lo producido donde alguien decide, con la certeza que le corresponde. | `lib/ml/` |
| **La frontera** | Lo único que las une, para que la unión sea un contrato y no consultas repartidas. | `lib/intelligence/serving.ts` |

### Por qué el motor es un servicio aparte

Porque es Python, y es Python porque la taxonomía que sostiene —XGBoost, ARIMA,
Isolation Forest, programación entera mixta— no existe en TypeScript de forma
honesta.

Tres propiedades del servicio, y las tres son de seguridad antes que de diseño:

- **No guarda nada.** Lee el histórico, entrena, devuelve el modelo serializado
  y se olvida. El ERP lo guarda en el esquema del inquilino. Es lo que sostiene
  la promesa que el producto ya le hace al cliente: *tus modelos viven donde
  viven tus datos, y un respaldo de tu base se los lleva consigo.*
- **No escribe en el ERP.** La taxonomía tiene una intención `ACTION` y esta capa
  la clasifica, pero ejecutarla es del ERP, detrás de sus permisos. Un servicio
  de modelos con permiso de escritura sobre la base del cliente es un riesgo que
  no compra nada.
- **No se expone.** Sin `ports` en el compose: solo lo alcanzan los contenedores
  de la red interna y su único cliente es `web`. Publicar el puerto sería abrir
  un servicio que puede leer el histórico de todas las empresas.

### Cómo se piensa una pregunta

Toda petición pasa por lo mismo antes de que se toque un modelo:

1. **¿Qué quiere saber esta persona?** → ocho intenciones cerradas.
2. **¿Cuál es el método más simple que lo contesta bien?** → seis escalones.
3. **Solo entonces**, qué modelo o consulta se invoca.

```
INTENCIÓN   QUERY · DIAGNOSIS · FORECAST · ANOMALY
            RECOMMENDATION · OPTIMIZATION · SIMULATION · ACTION

MÉTODO      L1_DETERMINISTIC   SQL, aritmética sobre hechos
            L2_STATISTICAL     medias, ventanas, líneas base
            L3_MACHINE_LEARNING
            L4_OPTIMIZATION
            L5_SIMULATION
            L6_ERP_ACTION
```

La regla que lo gobierna: **nunca se usa aprendizaje automático por el hecho de
tenerlo disponible.** «¿Cuánto inventario tengo?» es un `SELECT`, y contestarlo
con un estimador es cambiar una cifra cierta por una aproximada. Un método de
nivel 3 solo se elige cuando el 1 y el 2 no pueden contestar la pregunta.

### Sí, polars — y en los dos lados

`nodejs-polars` en Node (`lib/analytics/extract.ts`) y `polars` en Python
(`app/data.py`, `automl/*`). **Mismo motor Rust, mismo parquet, mismas
semánticas de ventana.** Los dos extremos del sistema hablan del mismo
dataframe, y eso es lo que evita que el conjunto con el que se entrena y el que
se sirve se separen sin que nadie lo note.

Una nota honesta sobre velocidad, porque está medida y contradice lo que suele
decirse: **a este tamaño Polars NO es más rápido que aritmética a mano** —pierde
por *marshalling* en conjuntos de cientos de filas—. Entra por la FORMA de las
expresiones (ventanas por entidad, desplazamientos, agregados temporales) y
porque es el mismo motor a los dos lados. Defenderlo por velocidad sería falso.

### Dos caminos de datos, que no hay que confundir

| | de dónde lee | para qué | estado |
|---|---|---|---|
| **Entrenar hoy** | Postgres, `search_path` fijado al esquema de **una** empresa | los modelos que sirven las pantallas | en uso |
| **El lago** (`lib/analytics/`) | `domain_events` → parquet en `tenant=<slug>/` | aprender de **varias** empresas, con consentimiento | construido, sin explotar |

El aislamiento por esquema —lo que hace vendible el producto ante un laboratorio
farmacéutico— hace imposible aprender de muchos inquilinos a la vez en el plano
transaccional. La salida no es relajar el aislamiento: es extraer al lago y
poner ahí la compuerta del consentimiento.

El extractor es incremental por `domain_events.id`, que es `bigserial` y no uuid
**exactamente para esto**: un entero que solo crece da un marcador de agua
exacto. Es solo-anexado (reprocesar es leer otra vez, no reescribir),
idempotente (el rango se reserva en Postgres antes de tocar un archivo) y
aislado por construcción (no hay un solo punto donde los datos de dos inquilinos
compartan estructura en memoria).

### Qué se guarda, y por qué en tablas separadas

Todo vive en el esquema de cada empresa:

| tabla | qué es |
|---|---|
| `ml_templates` | **Las preguntas** que la empresa quiere responder, con su tolerancia. No guarda SQL: guarda identificadores de bloques, y la consulta se compila desde ellos. |
| `ml_models` | Cada versión entrenada, con sus métricas y su veredicto. |
| `ml_predictions` | Predicciones **por entidad**, persistidas. Una predicción que solo existió en memoria durante un render no se puede comparar después con lo que pasó. |
| `ml_outcomes` | **Lo que pasó de verdad.** La tabla que casi todo producto con ML omite, y sin la cual no se puede responder «¿el modelo sigue sirviendo?». Va aparte porque el desenlace llega semanas después, y mezclarlos obligaría a corregir una fila ya escrita. |
| `ml_forecasts` | Pronósticos **por periodo**, con `issued_at`. Permite comparar lo que se dijo en marzo con lo que pasó, sin que la versión de hoy tape lo que la de marzo prometió. |
| `analysis_placements` | Qué análisis sale en qué pantalla. La **ausencia** de fila significa «de fábrica», por eso apagar guarda `active = false` en vez de borrar. |
| `dashboards` · `dashboard_modules` | Los tableros. No hay tabla de bloques: sus bloques son filas de `analysis_placements` con `screen = 'dashboard:<slug>'`. |

Una predicción es un hecho de su momento: **no se corrige**. De ahí que
reentrenar cree una versión nueva en vez de pisar la anterior — hay pronósticos
emitidos apuntando a ella, y borrarla dejaría huérfano el historial con el que
se mide si el modelo se degrada.

### Un modelo no se aprueba por decisión de una persona

Se aprueba porque **le ganó a la respuesta ingenua** en un *backtest* temporal.
La persona puede negarse a promoverlo, nunca forzarlo: es la única defensa
contra el sesgo de haber invertido esfuerzo en construirlo.

- **Líneas base a batir:** `naive`, `seasonal_naive`, `drift`.
- **Familias candidatas:** Ridge, Huber, *gradient boosting*, Random Forest y
  XGBoost — más la variante destendenciada. En el desempate **gana la más
  simple**, por regla del código y no por criterio de quien mira la tabla.
- **Umbrales:** el error tiene que bajar ≥ 5 % **y** haber evidencia de que
  cambia decisiones — o ≥ 5 puntos de aciertos dentro de la tolerancia, o una
  bajada de error tan grande (≥ 20 %) que el umbral se quede corto para medirla.
  Con la línea base ya ≥ 95 % la exigencia se relaja, porque no quedan puntos que
  ganar. El porqué de las dos vías, con el caso medido, está en el
  [README del motor](services/intelligence/README.md#el-examen).
- **La partición es temporal** y el tramo de prueba se toca **una sola vez**, con
  el ganador ya decidido: elegirlo mirando la prueba convertiría la medición en
  la búsqueda.

Los estados de un modelo son `backtested → production | rejected → retired`.
Un modelo **rechazado se conserva**: saber qué no funciona con los datos de esta
empresa vale tanto como lo que sí, y evita que alguien lo reintente en seis
meses.

### Lo que las pantallas garantizan

`lib/ml/insights.ts` sostiene cinco reglas, y son lo que vuelve esto
infraestructura en vez de un adorno:

1. **No calcula.** Lee predicciones ya escritas. Una pantalla que calcula hereda
   la latencia y el fallo del cálculo, y devuelve un número distinto en cada
   recarga — con lo que deja de ser auditable.
2. **No rompe.** Cada resolutor corre aislado y con presupuesto de tiempo. El
   análisis nunca puede ser la razón por la que alguien no puede cerrar un
   ticket.
3. **No repite trabajo.** Los resolutores reciben lo que la pantalla ya cargó.
4. **No inventa.** Todo hallazgo carga su evidencia (`because`) y cuántos casos
   lo sostienen (`support`). Un aviso sin sustento es ruido, y el ruido se
   aprende a ignorar en dos semanas.
5. **No se adelanta.** Solo lee modelos en producción.

Y la distinción que más importa está en los **tipos**, no en un comentario. Los
bloques van de lo que se sabe a lo que se estima —`finding`, `projection`,
`trend`, `forecast`— y:

- `forecast` **exige** `band` y `support`: no se puede construir un pronóstico
  sin decir entre qué valores se mueve y cuántos casos lo sostienen.
- `projection` **no admite** banda: si alguien quiere ponerle una, el compilador
  le dice que lo que tiene entre manos es un pronóstico.

«Vencen 213 600 el día 24» va a ocurrir: sale de vencimientos ya pactados. «Esta
visita llevará 5 h» puede fallar. Presentarlos igual enseña a tratarlos igual, y
el día que un pronóstico se equivoque se lleva por delante la credibilidad del
calendario, que no tenía culpa.

### Se degrada, no rompe

`lib/intelligence/client.ts` es el único punto que habla con el servicio, y
tiene cuatro reglas que impiden que un motor de modelos se vuelva un punto único
de fallo del ERP:

1. **Se degrada, no rompe.** Si el servicio no responde, cada llamada devuelve
   `null` y la pantalla se pinta sin la parte de inteligencia.
2. **Tiene presupuesto de tiempo, distinto por operación** — 4 s para clasificar
   o consultar el catálogo, 15 s para perfilar o pronosticar, 180 s para
   entrenar. Un mismo `timeout` para todo obligaría a elegir entre cortar
   entrenamientos válidos o colgar una pantalla medio minuto.
3. **Solo alcanza el esquema de la empresa activa.** El inquilino no lo elige
   quien llama: se lee del contexto de la petición, igual que en `tenantDb`.
4. **No ejecuta acciones.**

Además, una pregunta se publica **desde que se crea**, no desde que tiene
respuesta. Lo que cambia con el estado es *qué se dice*: `sirviendo`, `vencido`,
`lista`, `sin-datos`, `no-responde`, `sin-entrenar`. Los cuatro estados sin
pronóstico salen como hallazgo y **nunca como una cifra inventada para
rellenar**. Un pronóstico emitido en marzo sobre abril es basura en junio, y por
eso la vigencia se comprueba en vez de suponerse.

### El protocolo

`services/intelligence/app/contracts.py` y `src/lib/intelligence/contracts.ts`
son **espejo el uno del otro**, enfrentados a propósito para que la divergencia
se vea al leerlos en paralelo: no hay compilador que la atrape. Quien valida de
verdad es Pydantic, del lado Python.

| ruta | para qué | presupuesto |
|---|---|---|
| `GET /salud` | healthcheck del contenedor | 4 s |
| `POST /clasificar` | pregunta en español → intención + método | 4 s |
| `GET /catalogo` | qué se puede preguntar en cada módulo | 4 s |
| `GET /perfil/{tenant}/{serie_id}` | perfilado de la serie | 15 s |
| `POST /entrenar` | AutoML completo, devuelve el modelo serializado | 180 s |
| `POST /pronosticar` | proyección con banda | 15 s |

### Dónde se usa

- `/admin/inteligencia` — las preguntas de la empresa, su estado y su
  entrenamiento (requiere `analisis:administrar`).
- `/admin/dashboard/<slug>` — tableros libres, componibles sobre retícula de 24
  columnas.
- Las pantallas de trabajo de cada módulo, vía `placements`.

### Estado real

**Implementado:** clasificación de intención · catálogo por módulos · perfilado
· AutoML de pronóstico con cinco familias, destendenciado y líneas base fuertes
· proyección con banda · publicación en pantallas y tableros.

**Declarado y sin implementar:** regresión y clasificación sobre panel (el
contrato las admite y `/entrenar` responde 501 con el motivo), detección de
anomalías, optimización, simulación. `IMPLEMENTED` en `intents.py` es la lista
viva — por eso una pregunta de optimización se clasifica bien y responde
`supported: false` en vez de contestarse con lo que haya a mano.

**Columnas preparadas y todavía sin conectar:** `tickets.ml_suggested` (jsonb,
categoría y prioridad sugeridas) y `leads.score` (0–100). Existen en el schema y
hoy **no las escribe ni las lee nadie**. Son de la idea original de clasificar
tickets, que es una pregunta de tipo distinto a las que el motor contesta hoy
—clasificación sobre texto, no pronóstico sobre serie—, y sigue pendiente.

**Apache Iceberg:** evaluado y no adoptado todavía, a conciencia. El lago
parquet ya está en el layout Hive que `add_files` registra sin reescribir un
byte, el día que haga falta. Los tres disparadores concretos —cientos de
millones de filas, consultar varios inquilinos a la vez, o esquemas que cambien
entre versiones— están en
[`services/intelligence/README.md`](services/intelligence/README.md), y hoy no
se cumple ninguno.

### Trabajar en el servicio

El entorno virtual va **fuera del repositorio**, y no es preferencia: un `.venv`
dentro del proyecto tiene un symlink al intérprete de `uv`, fuera de la raíz, y
eso hace **entrar en pánico a Turbopack** al construir el ERP con un error que
no menciona Python por ningún lado. Ignorarlo en `.gitignore` no alcanza —
Turbopack recorre el disco, no el índice de git.

```bash
VENV=~/.venvs/astraion-intelligence
uv venv --python cpython-3.12-macos-aarch64-none "$VENV"   # arm64 explícito
uv pip install --python "$VENV/bin/python" -e ".[dev]"

cd services/intelligence
"$VENV/bin/python" -m pytest tests/ -q

set -a; . ../../.env.local; set +a
"$VENV/bin/python" -m uvicorn app.main:app --port 8099 --reload
```

El detalle completo del motor está en
**[`services/intelligence/README.md`](services/intelligence/README.md)**.
Para trabajar sobre esta capa hay un agente especializado en
`.claude/agents/inteligencia.md`.

| variable | qué es | por omisión |
|---|---|---|
| `INTELLIGENCE_URL` | dónde vive el motor | `http://intelligence:8000` |
| `ANALYTICS_LAKE_DIR` | raíz del lago parquet | `.lake/` (volumen en producción) |

> **`ML_SERVICE_URL` no es esto**, y el nombre engaña. Apunta a `evoai-backend`,
> el servicio de **evo_ai / cromatografía**, que es un módulo opcional —vive
> detrás del perfil `cromatografia` en el compose— y no tiene nada que ver con
> la capa de inteligencia. El motor de esta capa se configura con
> `INTELLIGENCE_URL` y no lleva perfil: no es opcional, es parte del producto.

## Scripts

| Comando            | Acción                                   |
| ------------------ | ---------------------------------------- |
| `npm run dev`      | Servidor de desarrollo                   |
| `npm run build`    | Build de producción                      |
| `npm run typecheck`| `tsc --noEmit`                           |
| `npm run db:migrate`| Aplica las migraciones a `public`       |
| `npm run db:seed`  | Datos demo                               |
| `npm run db:studio`| Drizzle Studio (explorador de datos)     |
| `npm run sync:prod`| Trae la base de producción a local       |
| `npm run deploy:prod`| Despliega al servidor                  |
