"""De una serie temporal a una matriz supervisada, sin mirar el futuro.

── LA INVARIANTE ──────────────────────────────────────────────────────────

Toda columna de esta matriz, para la fila del periodo `t`, se calcula
EXCLUSIVAMENTE con periodos anteriores a `t`.

Es la única defensa que importa y no se puede verificar leyendo el modelo, así
que se concentra aquí, en un solo archivo pequeño, y se comprueba con un
experimento aparte (`tests/test_features.py`): se corrompe el futuro y se exige
que ninguna fila del pasado cambie ni un decimal.

El fallo que evita es concreto y frecuente: una media móvil que incluye el
propio periodo. Sale un modelo con error bajísimo en el backtest que se
desploma el primer día en producción, y nadie encuentra el motivo porque
ninguna columna se ve sospechosa — el rasgo se calcula del propio objetivo,
correctamente, un instante demasiado tarde.

── POR QUÉ ESTAS COLUMNAS Y NO OTRAS ──────────────────────────────────────

Una serie de negocio tiene tres componentes que hay que poder separar, y cada
bloque de columnas atiende uno:

  NIVEL         los rezagos. Dónde está la serie ahora.
  TENDENCIA     el índice de tiempo. Es lo que permite EXTRAPOLAR, y sin él
                todo modelo queda encerrado en el rango histórico: es
                exactamente por qué un catálogo de modelos basados en medianas
                por grupo no pudo nunca pronosticar una serie que crece.
  ESTACIONALIDAD  el mes y el trimestre. Diciembre no se parece a enero y eso
                es calendario, no ruido.
"""

from __future__ import annotations

import polars as pl

#: Rezagos por defecto para grano mensual.
#:
#: 1, 2 y 3 dan el nivel reciente; 12 da el mismo mes del año anterior, que en
#: un negocio con cierre de ejercicio es la comparación que de verdad usa la
#: gente. El 6 está por el semestre, que en presupuestos públicos manda.
LAGS_MES = (1, 2, 3, 6, 12)
LAGS_SEMANA = (1, 2, 3, 4, 8, 52)
LAGS_DIA = (1, 2, 3, 7, 14, 28, 365)


def lags_for(grain: str) -> tuple[int, ...]:
    return {"month": LAGS_MES, "week": LAGS_SEMANA, "day": LAGS_DIA}[grain]


def build(df: pl.DataFrame, grain: str, horizon: int = 1) -> pl.DataFrame:
    """Añade las columnas de aprendizaje a una serie `at`/`value`.

    `horizon` desplaza el objetivo hacia adelante: con `horizon=3`, la fila del
    periodo `t` lleva las señales conocidas en `t` y como objetivo el valor de
    `t+3`. Es pronóstico DIRECTO — un modelo por horizonte — y no recursivo.

    La diferencia importa y se decidió a conciencia: el recursivo alimenta sus
    propias predicciones como entrada y acumula su error, así que a tres
    periodos ya está prediciendo sobre una historia que se inventó él. El
    directo cuesta un modelo por horizonte y a cambio cada uno se mide contra
    la realidad.
    """
    if df.height == 0:
        return df

    df = df.sort("at")
    ls = lags_for(grain)

    cols: list[pl.Expr] = []

    # ── NIVEL: los rezagos ───────────────────────────────────────────────
    for k in ls:
        cols.append(pl.col("value").shift(k).alias(f"lag_{k}"))

    # ── NIVEL suavizado: medias y medianas móviles, SIEMPRE desplazadas ──
    #
    # El `.shift(1)` va ANTES de la ventana, no después. Con la ventana
    # primero, el promedio de tres meses incluiría el mes que se quiere
    # predecir. Es un solo carácter de diferencia y es toda la fuga.
    pasado = pl.col("value").shift(1)
    for w in (3, 6, 12):
        cols.append(pasado.rolling_mean(window_size=w, min_samples=2).alias(f"media_{w}"))
        cols.append(pasado.rolling_std(window_size=w, min_samples=3).alias(f"desv_{w}"))
    cols.append(pasado.rolling_median(window_size=12, min_samples=4).alias("mediana_12"))

    # ── TENDENCIA: el índice de tiempo ───────────────────────────────────
    #
    # Un entero creciente. Es lo único de esta matriz que puede tomar valores
    # NUNCA VISTOS en el entrenamiento, y por eso es lo único que permite
    # extrapolar. Con modelos de árbol no alcanza —un árbol no extrapola, parte
    # por umbrales— y para eso está el término lineal explícito del registro.
    cols.append(pl.int_range(0, pl.len()).alias("t"))

    # Cambio reciente: la pendiente local, que es tendencia sin depender de la
    # escala del índice.
    cols.append((pl.col("value").shift(1) - pl.col("value").shift(2)).alias("delta_1"))
    cols.append((pl.col("value").shift(1) - pl.col("value").shift(13)).alias("delta_anual"))

    # ── ESTACIONALIDAD: el calendario ────────────────────────────────────
    #
    # Se conoce con años de anticipación, así que no hay nada que desplazar.
    if grain in ("month", "week"):
        cols.append(pl.col("at").dt.month().alias("mes"))
        cols.append(pl.col("at").dt.quarter().alias("trimestre"))
    if grain == "week":
        cols.append(pl.col("at").dt.week().alias("semana"))
    if grain == "day":
        cols.append(pl.col("at").dt.weekday().alias("dia_semana"))
        cols.append(pl.col("at").dt.month().alias("mes"))

    out = df.with_columns(cols)

    # El objetivo, desplazado hacia atrás tantos periodos como el horizonte.
    out = out.with_columns(pl.col("value").shift(-horizon).alias("y"))
    return out


def feature_names(df: pl.DataFrame) -> list[str]:
    """Las columnas de entrada. Excluye la fecha, el valor crudo y el objetivo.

    `value` NO es una señal: es el valor del periodo actual, que en el instante
    en que se predice `t+h` sí se conoce… pero ya está representado por
    `lag_1` de la fila siguiente. Dejarlo dentro duplicaría la información y
    haría imposible razonar sobre qué vio el modelo.
    """
    return [c for c in df.columns if c not in ("at", "value", "y", "key")]


def entrenable(df: pl.DataFrame) -> pl.DataFrame:
    """Las filas con objetivo conocido y suficientes rezagos.

    Se descartan las primeras —donde los rezagos largos son nulos— y las
    últimas, donde el objetivo cae fuera del histórico. Es pérdida real de
    datos y no se disimula: con 119 meses y rezago de 12, se entrena con 106.
    """
    return df.drop_nulls(subset=["y", "lag_1"])
