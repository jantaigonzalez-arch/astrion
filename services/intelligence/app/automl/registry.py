"""Las familias de modelos que compiten, y quién es el rival a batir.

── EL ORDEN NO ES ESTÉTICO ────────────────────────────────────────────────

`FORECASTERS` va de lo simple a lo complejo, y en el desempate gana el
primero. Un bosque que solo IGUALA a la media móvil no merece el puesto: añade
piezas que mantener, un artefacto más grande que guardar y una cifra más
difícil de explicar en una junta, a cambio de nada. La sencillez desempata, y
que sea una regla del código y no del criterio de quien mira la tabla es lo
que impide que gane el modelo que más ilusión daba.

── EL RIVAL A BATIR ───────────────────────────────────────────────────────

Aquí está corregido el fallo más grave del laboratorio anterior: usaba como
línea base «predecir siempre la mediana global». Contra una serie que crece
2,7× en diez años, esa línea base es tan mala que CUALQUIER modelo la supera,
y una mejora del 40 % sobre ella podía seguir siendo un pronóstico inútil.

La línea base correcta es la MÁS FUERTE de las respuestas ingenuas —el último
valor, el mismo mes del año pasado, la deriva— elegida sobre el propio tramo de
entrenamiento. Que se elija la más fuerte y no la más cómoda es el punto: si un
modelo no le gana al «igual que el mes pasado», no hay nada que promover.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

import numpy as np


class Fitted(Protocol):
    """Lo mínimo que tiene que saber hacer un modelo ya ajustado."""

    def predict(self, X: np.ndarray) -> np.ndarray: ...


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    build: Callable[[dict[str, Any]], Any]
    grid: list[dict[str, Any]]
    min_rows: int
    """Cuántas filas de ENTRENAMIENTO necesita para presentarse.

    Se comprueba contra el tramo con el que de verdad se va a entrenar, no
    contra el total. Un modelo que necesita 200 filas y ve 130 en el tramo no
    está en condiciones de competir: no pierde limpiamente, memoriza, y con un
    tramo de prueba chico puede ganar por suerte.
    """

    extrapolates: bool
    """¿Puede salir del rango histórico?

    Los modelos de árbol NO: parten por umbrales, así que su predicción está
    acotada por los valores que vieron. Da igual cuánta señal de tendencia se
    les dé. Se marca aquí porque para una serie creciente es la diferencia
    entre pronosticar y repetir el último año, y porque la búsqueda lo usa para
    avisar cuando el ganador no sabe extrapolar una serie que sí crece.
    """

    explains: bool
    """¿Se puede explicar su decisión en una junta?

    Importa de verdad en un ERP: a veces el negocio necesita un número que
    pueda defender, aunque otro modelo acierte un punto más.
    """


# ═══════════════════════════════════════════════════════════════════
#  Líneas base — las respuestas ingenuas
# ═══════════════════════════════════════════════════════════════════


class Naive:
    """El valor del periodo anterior. La respuesta de quien no tiene modelo."""

    id = "naive"
    label = "Igual que el periodo anterior"

    def __init__(self, col: int):
        self.col = col

    def predict(self, X: np.ndarray) -> np.ndarray:
        return X[:, self.col]


class SeasonalNaive:
    """El mismo periodo del año pasado.

    En un negocio con estacionalidad fuerte es una línea base sorprendentemente
    dura, y por eso está aquí: si un modelo no le gana a «lo mismo que el
    diciembre pasado», no ha aprendido la estacionalidad, la ha copiado.
    """

    id = "seasonal_naive"
    label = "Igual que el mismo periodo del año pasado"

    def __init__(self, col: int):
        self.col = col

    def predict(self, X: np.ndarray) -> np.ndarray:
        return X[:, self.col]


class Drift:
    """Último valor más la pendiente media del histórico.

    La línea base que SÍ extrapola. Es el rival honesto de una serie con
    tendencia, y el que deja en evidencia a un modelo que solo repite el nivel.
    """

    id = "drift"
    label = "Último valor más la tendencia media"

    def __init__(self, col_lag1: int, col_t: int):
        self.col_lag1 = col_lag1
        self.col_t = col_t
        self.pendiente = 0.0

    def fit(self, X: np.ndarray, y: np.ndarray) -> "Drift":
        # Pendiente por mínimos cuadrados sobre el índice de tiempo. Se ajusta
        # solo con el tramo de entrenamiento, como cualquier otro modelo: una
        # línea base que mira todo el histórico no es una línea base, es una
        # ventaja.
        t = X[:, self.col_t]
        if len(t) > 1 and np.ptp(t) > 0:
            self.pendiente = float(np.polyfit(t, y, 1)[0])
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        return X[:, self.col_lag1] + self.pendiente


# ═══════════════════════════════════════════════════════════════════
#  Los competidores
# ═══════════════════════════════════════════════════════════════════


def _ridge(p: dict[str, Any]):
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # Escalado antes de la regularización: sin él, la penalización castiga a la
    # columna con unidades grandes —el índice de tiempo, o los pesos— y deja
    # intactas las demás, así que el `alpha` significa cosas distintas según la
    # serie. Con escalado, el mismo alpha se comporta igual en todas.
    return make_pipeline(StandardScaler(), Ridge(alpha=p["alpha"]))


def _huber(p: dict[str, Any]):
    from sklearn.linear_model import HuberRegressor
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # Robusto a valores extremos, que en un ERP no son errores: son el mes en
    # que entró un pedido enorme. Mínimos cuadrados persigue ese punto y
    # deforma toda la recta; Huber lo acota.
    return make_pipeline(StandardScaler(), HuberRegressor(epsilon=p["epsilon"], max_iter=500))


def _tree(p: dict[str, Any]):
    from sklearn.ensemble import GradientBoostingRegressor

    return GradientBoostingRegressor(
        n_estimators=p["n"],
        max_depth=p["depth"],
        learning_rate=p["lr"],
        loss="absolute_error",
        random_state=SEED,
    )


def _forest(p: dict[str, Any]):
    from sklearn.ensemble import RandomForestRegressor

    return RandomForestRegressor(
        n_estimators=p["n"],
        max_depth=p["depth"],
        min_samples_leaf=p["leaf"],
        random_state=SEED,
        n_jobs=-1,
    )


def _xgb(p: dict[str, Any]):
    from xgboost import XGBRegressor

    return XGBRegressor(
        n_estimators=p["n"],
        max_depth=p["depth"],
        learning_rate=p["lr"],
        subsample=0.9,
        colsample_bytree=0.9,
        # Error absoluto y no cuadrático: toda la capa razona en medianas y
        # desviación absoluta porque las series de un ERP tienen cola derecha
        # —el mes del pedido enorme— y el error cuadrático persigue esa cola.
        objective="reg:absoluteerror",
        random_state=SEED,
        n_jobs=2,
        verbosity=0,
    )


class Detrended:
    """Un modelo cualquiera, ajustado sobre la serie SIN tendencia.

    Los modelos de árbol no extrapolan: parten por umbrales, así que su
    predicción queda encerrada en el rango de valores que vieron. Sobre una
    serie que crece 2,7× en diez años eso los condena — y se midió: en la serie
    de cuentas por pagar, los árboles con refuerzo ganaron la validación y
    terminaron un 20 % PEOR que «igual que el mes pasado» en el tramo de prueba.

    La salida no es excluirlos. Es quitarles el problema: se ajusta una recta
    sobre el índice de tiempo, el modelo aprende únicamente lo que la recta no
    explica —estacionalidad, nivel local, forma— y al predecir se vuelve a
    sumar la recta. Es el tratamiento clásico y deja competir a los árboles en
    lo que sí saben hacer, en vez de castigarlos por lo que no.

    La recta se ajusta SOLO con el tramo que recibe `fit`. Ajustarla sobre todo
    el histórico sería una fuga difícil de ver: la pendiente llevaría dentro
    información de los periodos que se van a medir.
    """

    def __init__(self, inner, col_t: int):
        self.inner = inner
        self.col_t = col_t
        self.a = 0.0
        self.b = 0.0

    def _tendencia(self, X: np.ndarray) -> np.ndarray:
        return self.a * X[:, self.col_t] + self.b

    def fit(self, X: np.ndarray, y: np.ndarray) -> "Detrended":
        t = X[:, self.col_t]
        if len(t) > 2 and np.ptp(t) > 0:
            self.a, self.b = (float(v) for v in np.polyfit(t, y, 1))
        else:
            self.a, self.b = 0.0, float(np.mean(y))
        self.inner.fit(X, y - self._tendencia(X))
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.inner.predict(X) + self._tendencia(X)


#: La semilla es parte de la configuración, no del reloj.
#:
#: Dos entrenamientos sobre el mismo conjunto congelado tienen que dar
#: exactamente lo mismo, o el peritaje de reproducibilidad empieza a fallar sin
#: que nada esté roto.
SEED = 20260817


FORECASTERS: list[Family] = [
    Family(
        id="ridge",
        label="Regresión regularizada",
        build=_ridge,
        grid=[{"alpha": a} for a in (0.1, 1.0, 10.0)],
        min_rows=24,
        extrapolates=True,
        explains=True,
    ),
    Family(
        id="huber",
        label="Regresión robusta",
        build=_huber,
        grid=[{"epsilon": e} for e in (1.35, 2.0)],
        min_rows=24,
        extrapolates=True,
        explains=True,
    ),
    Family(
        id="gradient_boosting",
        label="Árboles con refuerzo",
        build=_tree,
        grid=[
            {"n": 200, "depth": 2, "lr": 0.05},
            {"n": 300, "depth": 3, "lr": 0.05},
        ],
        min_rows=48,
        extrapolates=False,
        explains=False,
    ),
    Family(
        id="random_forest",
        label="Bosque aleatorio",
        build=_forest,
        grid=[
            {"n": 300, "depth": 6, "leaf": 3},
            {"n": 500, "depth": 10, "leaf": 2},
        ],
        min_rows=60,
        extrapolates=False,
        explains=False,
    ),
    Family(
        id="xgboost",
        label="XGBoost",
        build=_xgb,
        grid=[
            {"n": 300, "depth": 3, "lr": 0.05},
            {"n": 600, "depth": 4, "lr": 0.03},
        ],
        min_rows=72,
        extrapolates=False,
        explains=False,
    ),
]


def family_by_id(fid: str) -> Family | None:
    return next((f for f in FORECASTERS if f.id == fid), None)
