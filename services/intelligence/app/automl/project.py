"""Del modelo entrenado a puntos en el futuro, con banda.

── POR QUÉ RECURSIVO AQUÍ Y DIRECTO AL MEDIR ──────────────────────────────

El examen entrena un modelo por horizonte —pronóstico DIRECTO— porque así cada
horizonte se mide contra la realidad y no contra las predicciones del propio
modelo. Para PROYECTAR, en cambio, hace falta una fila por periodo futuro, y
esa fila necesita los rezagos de los periodos anteriores… que todavía no han
ocurrido. No hay alternativa: se alimentan con lo predicho.

Eso acumula error, y la consecuencia se dice en voz alta en vez de esconderse:
la banda se ENSANCHA con la distancia. El periodo siguiente lleva la
incertidumbre del modelo; el sexto lleva además la de los cinco pronósticos
que tuvo que usar como si fueran datos.

── LA BANDA ───────────────────────────────────────────────────────────────

Sale del error absoluto del modelo en el tramo de prueba, no de un supuesto de
normalidad. Es lo honesto con series de negocio: tienen cola derecha —el mes
del pedido enorme— y una banda gaussiana la subestima justo donde más importa.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import polars as pl

from ..contracts import ForecastPoint
from . import features as F


def _siguiente(d: date, grain: str) -> date:
    if grain == "month":
        return date(d.year + (d.month == 12), 1 if d.month == 12 else d.month + 1, 1)
    if grain == "week":
        from datetime import timedelta

        return d + timedelta(days=7)
    from datetime import timedelta

    return d + timedelta(days=1)


def project(
    modelo,
    cols: list[str],
    df: pl.DataFrame,
    grain: str,
    periods: int,
    *,
    mae: float,
) -> list[ForecastPoint]:
    """Extiende la serie `periods` periodos hacia adelante."""
    serie = df.select(["at", "value"]).sort("at")
    salida: list[ForecastPoint] = []

    for k in range(1, periods + 1):
        # Se reconstruye la matriz completa cada paso. Cuesta más de lo
        # necesario y evita el fallo clásico: mantener a mano los rezagos y las
        # ventanas en paralelo a `features.build` es garantizar que un día se
        # separen y el modelo reciba en producción columnas distintas a las del
        # entrenamiento, sin que nada avise.
        proximo = _siguiente(serie["at"].to_list()[-1], grain)
        con_fila = pl.concat(
            [
                serie,
                pl.DataFrame({"at": [proximo], "value": [None]}).cast(serie.schema),
            ]
        )
        mat = F.build(con_fila, grain, horizon=0)
        fila = mat.tail(1)

        x = fila.select(cols).to_numpy().astype(float)
        # Los nulos de rezagos largos se rellenan con la mediana de la columna
        # en el histórico, igual que al entrenar.
        col_med = mat.select(cols).to_numpy().astype(float)
        med = np.nanmedian(col_med, axis=0)
        med = np.where(np.isnan(med), 0.0, med)
        idx = np.isnan(x)
        x[idx] = np.take(med, np.where(idx)[1])

        y = float(modelo.predict(x)[0])

        # La banda crece con la raíz de la distancia: es la propagación de un
        # error que se suma paso a paso, no lineal —que la exageraría— ni
        # constante, que mentiría por optimismo.
        ancho = mae * np.sqrt(k)
        salida.append(
            ForecastPoint(
                at=proximo,
                value=y,
                lower=y - ancho,
                upper=y + ancho,
            )
        )

        # El valor predicho entra como si fuera dato. Es lo que hace recursiva
        # la proyección y la razón de que la banda se abra.
        serie = pl.concat(
            [serie, pl.DataFrame({"at": [proximo], "value": [y]}).cast(serie.schema)]
        )

    return salida


def history_points(df: pl.DataFrame, last: int = 36) -> list[ForecastPoint]:
    """Lo ya ocurrido, en el mismo formato, para dibujarlo junto al pronóstico.

    Sin banda —es un hecho, no una estimación— y por eso `lower` y `upper`
    valen lo mismo que el valor. La gráfica los distingue por ahí, sin
    necesidad de un campo que diga cuál es cuál.
    """
    tail = df.tail(last)
    return [
        ForecastPoint(at=r["at"], value=float(r["value"]), lower=float(r["value"]), upper=float(r["value"]))
        for r in tail.iter_rows(named=True)
    ]
