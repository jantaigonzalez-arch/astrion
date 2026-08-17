"""Los contratos entre el ERP y la capa de inteligencia.

Pydantic y no diccionarios sueltos por un motivo que se paga solo: este
servicio vive en otro proceso y en otro lenguaje que quien lo llama. Un campo
mal escrito entre Next.js y Python no lo atrapa ningún compilador — lo atrapa
un usuario, en producción, viendo un número equivocado. Aquí lo atrapa el
borde, con el nombre del campo y el valor recibido.

`src/lib/intelligence/contracts.ts` es el espejo de este archivo en TypeScript.
Si cambia uno, cambia el otro; están enfrentados a propósito para que la
divergencia se vea al leerlos en paralelo.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .intents import Domain, Horizon, Intent, Level


# ═══════════════════════════════════════════════════════════════════
#  1 · Clasificación de intención
# ═══════════════════════════════════════════════════════════════════


class Classification(BaseModel):
    """Lo que la capa entendió, ANTES de ejecutar nada.

    Es la respuesta a la primera pregunta —qué quiere saber esta persona— y se
    devuelve sola, sin resultados. Que se pueda pedir por separado no es un
    detalle de diseño: permite enseñarle al usuario cómo se interpretó su
    pregunta y dejarle corregirla antes de que nadie gaste un entrenamiento.
    """

    primary_intent: Intent
    secondary_intents: list[Intent] = Field(default_factory=list)
    business_domain: list[Domain] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    """Los sustantivos del negocio que aparecen: la pieza, el equipo, el mes."""

    time_horizon: Horizon
    required_data: list[str] = Field(default_factory=list)
    """Qué tablas del esquema del inquilino hacen falta. Nombres reales."""

    analytical_method: str
    recommended_model: str | None = None
    level: Level
    """El escalón elegido. Ver la jerarquía en `intents.py`."""

    requires_ml: bool
    requires_erp_action: bool
    confidence: float = Field(ge=0.0, le=1.0)

    clarification_required: bool = False
    clarification_question: str | None = None

    supported: bool = True
    """¿Sabe la capa ejecutar esto hoy?

    Se separa de `confidence` porque son cosas distintas y confundirlas miente
    en las dos direcciones: entender perfectamente una pregunta de optimización
    que todavía no se sabe resolver no es baja confianza, es una capacidad que
    falta. Y decirlo así es lo que permite priorizar cuál construir.
    """

    unsupported_reason: str | None = None

    why: list[str] = Field(default_factory=list)
    """Las señales que llevaron a esta clasificación.

    Viaja porque una clasificación sin motivo no se puede discutir, y esta
    decide si se entrena un modelo o se corre un SELECT. Ver `classify.py`.
    """


class ClassifyRequest(BaseModel):
    question: str
    tenant: str
    locale: str = "es"
    module: str | None = None
    """Desde qué módulo se preguntó, si se preguntó desde uno.

    Es una pista fuerte y barata: la misma frase «¿cómo va esto?» significa
    cosas distintas en Compras y en Ventas, y el módulo lo resuelve sin pedirle
    nada al usuario.
    """


# ═══════════════════════════════════════════════════════════════════
#  2 · Definición de una pregunta configurada
# ═══════════════════════════════════════════════════════════════════


TaskKind = Literal["forecast", "regression", "classification", "anomaly"]


class Question(BaseModel):
    """Una pregunta que el usuario dejó configurada en un módulo.

    Es el objeto que el usuario crea desde la pantalla: en qué módulo, qué
    quiere responder, sobre qué entidad, con qué horizonte y con qué familia
    de modelos —o dejando que el AutoML elija—.

    No lleva SQL. El usuario elige de un catálogo cerrado de sujetos y señales
    (`catalog.py`) y el servicio compila la consulta: es la única forma de que
    una pregunta creada desde una pantalla no pueda mirar el futuro por
    accidente.
    """

    slug: str
    module: str
    label: str
    question: str

    task: TaskKind
    subject: str
    """De qué entidad se predice: la pieza, el equipo, el mes, el negocio."""

    target: str
    """Qué se predice. Del catálogo del sujeto."""

    features: list[str] = Field(default_factory=list)
    """Señales elegidas. Vacío = que las elija el AutoML."""

    horizon: int = 1
    """Cuántos periodos hacia adelante. Solo para `forecast`."""

    grain: Literal["day", "week", "month"] = "month"
    """El grano temporal de un pronóstico."""

    tolerance: float
    tolerance_kind: Literal["absolute", "relative"] = "relative"

    algorithm: str | None = None
    """Familia forzada por el usuario, o `None` para AutoML.

    Que se pueda forzar importa: a veces el negocio necesita un modelo que
    pueda explicar en una junta, aunque otro acierte un poco más. El sistema
    lo permite y deja escrito que fue elección, no búsqueda.
    """


# ═══════════════════════════════════════════════════════════════════
#  3 · Perfilado y entrenamiento
# ═══════════════════════════════════════════════════════════════════


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    nulls: int
    distinct: int
    is_constant: bool
    sample: list[str] = Field(default_factory=list)


class DataProfile(BaseModel):
    """Qué hay en los datos, antes de entrenar con ellos.

    Se mira SIEMPRE y se enseña al usuario. La mitad de los fracasos de un
    modelo no son del modelo: son un objetivo constante, un histórico de seis
    casos o una columna vacía en el 99 % de las filas. Todo eso se ve aquí en
    un segundo y ahorra un entrenamiento que iba a salir mal por motivos que
    después nadie encuentra.
    """

    rows: int
    from_at: datetime | None = None
    to_at: datetime | None = None
    target_distinct: int
    target_constant: bool
    entities: int | None = None
    columns: list[ColumnProfile] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    """Lo que hay que decirle al usuario aunque no lo haya pedido."""


class Candidate(BaseModel):
    """Un competidor de la búsqueda AutoML y cómo le fue."""

    algorithm: str
    label: str
    params: dict[str, Any] = Field(default_factory=dict)
    val_error: float
    """Error sobre el tramo de VALIDACIÓN. Nunca sobre el de prueba."""

    fitted: bool = True
    skipped_reason: str | None = None


class Backtest(BaseModel):
    """La medición del ganador, sobre el tramo que se estrena al final.

    Con corte TEMPORAL, nunca aleatorio. Un split al azar deja que el modelo se
    entrene con el futuro del mismo equipo o del mismo cliente y produce una
    métrica optimista que se desploma en producción.
    """

    mae: float
    baseline_mae: float
    """La respuesta ingenua. Es el rival a batir, no un adorno."""

    baseline_name: str
    improvement_pct: float
    within_tolerance_pct: float
    baseline_within_tolerance_pct: float
    """Los aciertos de la respuesta ingenua con el mismo margen.

    Sin esta cifra el porcentaje de aciertos no se puede leer: un fenómeno muy
    disperso tiene un techo que ningún modelo pasa, y exigir un número fijo
    ahí es exigir lo imposible y culpar al modelo.
    """

    n_train: int
    n_val: int
    n_test: int
    cutoff: datetime
    horizon: int = 1


class Verdict(BaseModel):
    approved: bool
    reason: str


class TrainRequest(BaseModel):
    tenant: str
    question: Question


class TrainResult(BaseModel):
    slug: str
    profile: DataProfile
    winner: Candidate | None = None
    leaderboard: list[Candidate] = Field(default_factory=list)
    backtest: Backtest | None = None
    verdict: Verdict
    model_blob: str | None = None
    """El modelo entrenado, serializado, para guardarlo en el ERP.

    Vuelve al ERP y vive en el esquema del inquilino, no en este servicio. El
    servicio es un motor sin estado: se puede reiniciar, escalar o reemplazar
    sin que ninguna empresa pierda nada.
    """

    trained_up_to: datetime | None = None
    seed: int


# ═══════════════════════════════════════════════════════════════════
#  4 · Pronóstico
# ═══════════════════════════════════════════════════════════════════


class ForecastPoint(BaseModel):
    at: date
    value: float
    lower: float
    upper: float
    """La banda. Un pronóstico sin banda invita a leerlo como certeza."""


class ForecastRequest(BaseModel):
    """Petición de proyección.

    El modelo viaja en el CUERPO y no en la URL: un modelo serializado son
    decenas de kilobytes y una query string no los admite —el servidor
    respondía «Invalid HTTP request» sin más explicación—. Que el ERP lo mande
    en cada llamada es la consecuencia de que este servicio no guarde estado, y
    se paga a gusto: ver la cabecera de `main.py`.
    """

    tenant: str
    serie_id: str
    model_blob: str
    periods: int = 6
    mae: float = 0.0
    """El error medido en el backtest. De aquí sale el ancho de la banda: sin
    él la proyección saldría sin incertidumbre, que es la forma más eficaz de
    que alguien lea un pronóstico como una promesa."""


class ForecastResult(BaseModel):
    slug: str
    subject_key: str | None = None
    points: list[ForecastPoint]
    history: list[ForecastPoint] = Field(default_factory=list)
    """Lo ya ocurrido, para que la gráfica enseñe pronóstico y pasado juntos."""

    model: str
    trained_up_to: datetime | None = None
