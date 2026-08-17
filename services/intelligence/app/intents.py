"""La taxonomía de intención y la jerarquía de métodos.

Este archivo es la ley de la capa. Todo lo demás la aplica.

── POR QUÉ UNA TAXONOMÍA Y NO UN MODELO PARA TODO ─────────────────────────

Un ERP con machine learning dentro tiende a un fallo concreto: alguien
entrena un modelo y a partir de ahí toda pregunta se contesta con ese modelo,
incluidas las que ya tenían respuesta exacta en la base. «¿Cuánto inventario
tengo?» no es una predicción — es un SELECT, y contestarla con un estimador
es peor que inútil: es una cifra aproximada donde había una cierta.

La taxonomía existe para hacer esa distinción ANTES de tocar nada. Primero
qué quiere saber la persona, después cuál es el método más simple que lo
contesta de forma fiable, y solo entonces qué modelo o consulta se invoca.

── LA REGLA QUE GOBIERNA TODO ─────────────────────────────────────────────

Nunca se usa aprendizaje automático por el hecho de tenerlo disponible.

`NIVELES` de abajo está ordenado de lo determinista a lo caro, y la búsqueda
siempre empieza por arriba. Un método de nivel 3 solo se elige cuando los
niveles 1 y 2 no pueden contestar la pregunta, no cuando podrían contestarla
peor. Es la misma disciplina que se le exige al veredicto de un modelo —hay
que ganarle a la respuesta ingenua— aplicada un escalón antes: al método.
"""

from __future__ import annotations

from enum import StrEnum


class Intent(StrEnum):
    """Qué quiere la persona. Cerrado a propósito: ocho casos, no un texto libre.

    Un conjunto cerrado es lo que permite que el resto de la capa sea código y
    no interpretación. Cada intención tiene métodos admisibles, datos exigidos
    y una forma de respuesta; con intenciones abiertas, nada de eso se puede
    declarar y todo acaba resolviéndose con el mismo modelo genérico.
    """

    QUERY = "QUERY"
    """Recuperar lo que ya está registrado. No es una predicción."""

    DIAGNOSIS = "DIAGNOSIS"
    """Entender POR QUÉ pasó algo. Mira hacia atrás y busca causa."""

    FORECAST = "FORECAST"
    """Qué va a pasar. La razón de ser de esta capa."""

    ANOMALY = "ANOMALY"
    """Qué se está comportando raro."""

    RECOMMENDATION = "RECOMMENDATION"
    """Qué CONVIENE hacer. Lleva un pronóstico dentro, casi siempre."""

    OPTIMIZATION = "OPTIMIZATION"
    """La MEJOR decisión sujeta a restricciones."""

    SIMULATION = "SIMULATION"
    """Qué pasaría si cambio esta variable."""

    ACTION = "ACTION"
    """Ejecutar una operación en el ERP. Exige autorización, siempre."""


class Level(StrEnum):
    """El escalón de método. Ordenado de lo determinista a lo caro.

    El orden no es una preferencia estética: cada escalón hacia abajo añade
    supuestos, varianza y algo que mantener. Subir de escalón sin necesidad es
    cambiar una respuesta exacta por una aproximada y llamarlo mejora.
    """

    QUERY = "L1_DETERMINISTIC"
    """La respuesta ya está en la base. SQL. Cero modelo."""

    STATS = "L2_STATISTICAL"
    """Agregación, comparación, tendencia, descriptiva."""

    ML = "L3_MACHINE_LEARNING"
    """Predicción, clasificación, ranking, detección de patrón."""

    OPTIMIZATION = "L4_OPTIMIZATION"
    """Mejor decisión bajo restricciones."""

    SIMULATION = "L5_SIMULATION"
    """Escenarios y propagación de incertidumbre."""

    ACTION = "L6_ERP_ACTION"
    """Escribir en el ERP. Detrás de autorización y validación."""


#: Escalón MÍNIMO admisible por intención.
#:
#: Mínimo y no fijo: una intención puede necesitar subir —«cuánto debería
#: pedir» arranca en optimización pero necesita un pronóstico debajo— pero
#: nunca puede bajar de aquí sin dejar de contestar la pregunta. Es el suelo
#: que impide que una recomendación se resuelva con un promedio.
FLOOR: dict[Intent, Level] = {
    Intent.QUERY: Level.QUERY,
    Intent.DIAGNOSIS: Level.STATS,
    Intent.FORECAST: Level.ML,
    Intent.ANOMALY: Level.STATS,
    Intent.RECOMMENDATION: Level.ML,
    Intent.OPTIMIZATION: Level.OPTIMIZATION,
    Intent.SIMULATION: Level.SIMULATION,
    Intent.ACTION: Level.ACTION,
}

#: Escalón MÁXIMO que esta capa sabe ejecutar hoy.
#:
#: Se declara para poder decir «esto lo entiendo pero todavía no lo sé hacer»
#: en vez de contestarlo con lo que haya a mano. Una capa que degrada en
#: silencio a un método más pobre del que la pregunta pide es exactamente
#: cómo se pierde la confianza en ella.
IMPLEMENTED: frozenset[Level] = frozenset(
    {Level.QUERY, Level.STATS, Level.ML}
)


class Domain(StrEnum):
    """El dominio del ERP al que pertenece la pregunta.

    Sirve para dos cosas concretas, no para clasificar por clasificar: acota
    qué tablas se pueden leer, y decide en qué módulo de la pantalla aparece
    la respuesta.
    """

    INVENTORY = "Inventory"
    PURCHASING = "Purchasing"
    SALES = "Sales"
    CUSTOMERS = "Customers"
    SUPPLIERS = "Suppliers"
    PRODUCTS = "Products"
    PRICING = "Pricing"
    PROMOTIONS = "Promotions"
    FINANCE = "Finance"
    RECEIVABLES = "Accounts Receivable"
    PAYABLES = "Accounts Payable"
    LOGISTICS = "Logistics"
    PRODUCTION = "Production"
    DEMAND = "Demand Planning"
    WORKFORCE = "Workforce"
    SERVICE = "Service"
    GENERAL = "General Business Analytics"


class Horizon(StrEnum):
    """Hacia dónde y cuán lejos mira la pregunta.

    `PAST` no es un horizonte degenerado: es la marca de que la pregunta NO
    necesita un modelo. Distinguirlo aquí evita entrenar para contestar algo
    que ya ocurrió y está registrado.
    """

    PAST = "past"
    NOW = "now"
    SHORT = "short_term"
    """Días o semanas."""
    MEDIUM = "medium_term"
    """Uno a tres meses."""
    LONG = "long_term"
    """Un trimestre o más."""


def floor_for(intents: list[Intent]) -> Level:
    """El escalón mínimo que exige un conjunto de intenciones.

    Manda la MÁS exigente. Una pregunta que es a la vez recomendación y
    consulta necesita el modelo: resolverla con la parte fácil dejaría sin
    contestar la que importa.
    """
    orden = list(Level)
    return max((FLOOR[i] for i in intents), key=orden.index, default=Level.QUERY)


def is_supported(level: Level) -> bool:
    """¿Sabe esta capa ejecutar ese escalón hoy? Ver `IMPLEMENTED`."""
    return level in IMPLEMENTED
