"""Qué hay en los datos, antes de entrenar con ellos.

Se corre SIEMPRE y se enseña al usuario, incluso cuando el entrenamiento sale
bien. La razón: la mitad de los fracasos de un modelo no son del modelo. Son un
objetivo constante, un histórico de seis casos, una columna vacía en el 99 % de
las filas o un mes en curso contado como mes completo. Todo eso se ve aquí en un
segundo, y sin verlo el usuario recibe un veredicto negativo sin causa —«no
alcanza»— y concluye que el ERP no sirve para esto.

Los avisos están escritos para quien opera el negocio, no para quien entrena
modelos: dicen qué hay que arreglar en el registro del dato, no qué
hiperparámetro mover.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import polars as pl

from ..catalog import Serie
from ..contracts import ColumnProfile, DataProfile


def profile_series(df: pl.DataFrame, serie: Serie) -> DataProfile:
    if df.height == 0:
        return DataProfile(
            rows=0,
            target_distinct=0,
            target_constant=True,
            warnings=[
                "No hay ni un periodo con datos. La consulta es correcta y el "
                "histórico está vacío: es un problema de captura, no de modelo."
            ],
        )

    v = df["value"].to_numpy().astype(float)
    distintos = int(len(np.unique(v)))
    avisos: list[str] = []

    if df.height < serie.min_periods:
        faltan = serie.min_periods - df.height
        avisos.append(
            f"Hay {df.height} periodos de historia y hacen falta {serie.min_periods}: "
            f"faltan {faltan}. Con menos de dos años completos no se puede distinguir "
            f"la estacionalidad del ruido."
        )

    if distintos <= 1:
        avisos.append(
            "El valor es idéntico en todos los periodos. Nada que aprender, y el "
            "motivo casi siempre es cómo se registra el dato."
        )

    ceros = int(np.sum(v == 0))
    if ceros > df.height * 0.3:
        avisos.append(
            f"{ceros} de {df.height} periodos valen cero. Si de verdad no hubo "
            f"actividad, está bien; si es que el dato no se capturó, el modelo va a "
            f"aprender que esos meses son flojos."
        )

    # Cola derecha: importa porque decide si la mediana o la media es la
    # estadística correcta, y porque un solo pico puede dominar el error.
    if distintos > 3:
        mediana = float(np.median(v))
        p95 = float(np.percentile(v, 95))
        if mediana > 0 and p95 / mediana > 3:
            avisos.append(
                f"La cola es larga: el periodo del percentil 95 vale "
                f"{p95 / mediana:.1f} veces la mediana. El error promedio va a estar "
                f"dominado por unos pocos periodos extraordinarios."
            )

    fechas = df["at"].to_list()

    # Dos años de cola: lo suficiente para ver la estacionalidad al lado del
    # pronóstico sin convertir la gráfica en el histórico completo, que a 119
    # periodos aplana la parte que interesa.
    cola = df.tail(24)

    return DataProfile(
        rows=df.height,
        from_at=_dt(fechas[0]),
        to_at=_dt(fechas[-1]),
        target_distinct=distintos,
        target_constant=distintos <= 1,
        entities=None,
        columns=[
            ColumnProfile(
                name="value",
                dtype=str(df["value"].dtype),
                nulls=int(df["value"].null_count()),
                distinct=distintos,
                is_constant=distintos <= 1,
                sample=[f"{x:g}" for x in v[:5]],
            )
        ],
        warnings=avisos,
        tail=[
            {"at": str(r["at"]), "value": float(r["value"])}
            for r in cola.iter_rows(named=True)
        ],
    )


def profile_panel(df: pl.DataFrame, target_col: str = "target") -> DataProfile:
    if df.height == 0:
        return DataProfile(
            rows=0, target_distinct=0, target_constant=True,
            warnings=["No hay ningún caso observado en el histórico."],
        )

    y = df[target_col].to_numpy().astype(float)
    distintos = int(len(np.unique(y)))
    avisos: list[str] = []

    if distintos <= 1:
        avisos.append(
            "El valor a predecir es idéntico en todos los casos. Es el peor fallo "
            "posible de un histórico grande, y es de registro: pasó de verdad en "
            "este ERP con «días hasta resolverse», donde los tickets importados "
            "traían la fecha de cierre igual a la de creación."
        )

    columnas: list[ColumnProfile] = []
    for c in df.columns:
        if c in ("at", target_col):
            continue
        s = df[c]
        d = int(s.n_unique())
        nulos = int(s.null_count())
        vacios = int((s == "").sum()) if s.dtype == pl.String else 0
        columnas.append(
            ColumnProfile(
                name=c,
                dtype=str(s.dtype),
                nulls=nulos + vacios,
                distinct=d,
                is_constant=d <= 1,
                sample=[str(x) for x in s.head(4).to_list()],
            )
        )
        if d <= 1:
            avisos.append(f"La señal «{c}» tiene un solo valor: no agrupa nada.")
        elif (nulos + vacios) > df.height * 0.9:
            avisos.append(
                f"La señal «{c}» está vacía en {nulos + vacios} de {df.height} casos. "
                f"No estorba —el modelo simplemente no parte por ella— pero tampoco "
                f"aporta hasta que se capture."
            )

    entidades = int(df["subject_key"].n_unique()) if "subject_key" in df.columns else None
    if entidades and entidades > 0:
        por = df.height / entidades
        if por < 3:
            avisos.append(
                f"Hay {df.height} casos repartidos en {entidades} entidades: {por:.1f} "
                f"por entidad. Resumir el pasado de algo que ocurrió dos veces es "
                f"ruido con forma de señal."
            )

    fechas = df["at"].to_list() if "at" in df.columns else []
    return DataProfile(
        rows=df.height,
        from_at=_dt(fechas[0]) if fechas else None,
        to_at=_dt(fechas[-1]) if fechas else None,
        target_distinct=distintos,
        target_constant=distintos <= 1,
        entities=entidades,
        columns=columnas,
        warnings=avisos,
    )


def _dt(x) -> datetime | None:
    if x is None:
        return None
    if isinstance(x, datetime):
        return x
    return datetime.combine(x, datetime.min.time())
