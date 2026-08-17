"""La búsqueda: quién gana, medido una sola vez.

── QUÉ ES AUTOML AQUÍ Y QUÉ NO ────────────────────────────────────────────

No es «probar todo y quedarse con el número más bonito». Eso, con decenas de
candidatos y un tramo de prueba de treinta periodos, produce un ganador por
azar con bastante frecuencia, y lo peor es que produce un ganador CON MÉTRICA
BUENA, así que nada avisa.

Es una búsqueda con tres restricciones que la hacen honesta:

  1 · Cada familia declara cuántas filas necesita y no se presenta si no las
      hay. Un modelo que memoriza no pierde limpiamente: puede ganar por
      suerte.
  2 · La elección se hace mirando SOLO el tramo de validación. El de prueba se
      estrena con el ganador ya decidido.
  3 · La línea base es la más FUERTE de las respuestas ingenuas, no la más
      cómoda de batir. Y el ganador tiene que superarla en las dos cosas que
      importan: error y aciertos.

Al final se guarda el modelo reajustado con TODO el histórico. El corte servía
para medir, no para producir el que va a predecir mañana.
"""

from __future__ import annotations

import base64
import pickle
from datetime import datetime

import numpy as np
import polars as pl

from ..contracts import Candidate, TrainResult, Verdict
from ..catalog import Serie
from . import features as F
from .evaluate import measure, split_temporal, verdict_for
from .registry import (
    FORECASTERS,
    SEED,
    Detrended,
    Drift,
    Naive,
    SeasonalNaive,
    family_by_id,
)
from .profile import profile_series


def _matriz(df: pl.DataFrame, cols: list[str]) -> np.ndarray:
    # Los nulos que quedan son de rezagos largos en filas tempranas. Se
    # rellenan con la MEDIANA de la columna en el tramo de entrenamiento, no
    # con cero: un cero en «media de 12 meses» es un dato que dice «no hubo
    # negocio», y eso es falso — dice «todavía no había doce meses».
    m = df.select(cols).to_numpy().astype(float)
    med = np.nanmedian(np.where(np.isnan(m), np.nan, m), axis=0)
    med = np.where(np.isnan(med), 0.0, med)
    idx = np.isnan(m)
    m[idx] = np.take(med, np.where(idx)[1])
    return m


def _baselines(cols: list[str]):
    """Las respuestas ingenuas disponibles según las columnas que existan."""
    fuera = []
    if "lag_1" in cols:
        fuera.append(Naive(cols.index("lag_1")))
    if "lag_12" in cols:
        fuera.append(SeasonalNaive(cols.index("lag_12")))
    if "lag_1" in cols and "t" in cols:
        fuera.append(Drift(cols.index("lag_1"), cols.index("t")))
    return fuera


def buscar_forecast(
    serie: Serie,
    df: pl.DataFrame,
    *,
    horizon: int = 1,
    forced: str | None = None,
) -> TrainResult:
    """Entrena y evalúa un pronóstico para una serie. No escribe nada."""
    perfil = profile_series(df, serie)

    if df.height < serie.min_periods:
        return TrainResult(
            slug=serie.id,
            profile=perfil,
            verdict=Verdict(
                approved=False,
                reason=(
                    f"Hay {df.height} periodos y hacen falta {serie.min_periods} para "
                    f"separar estacionalidad de ruido. No es un problema del modelo: "
                    f"con menos de dos años no se puede saber si el pico de diciembre "
                    f"es diciembre o casualidad."
                ),
            ),
            seed=SEED,
        )

    if perfil.target_constant:
        return TrainResult(
            slug=serie.id,
            profile=perfil,
            verdict=Verdict(
                approved=False,
                reason=(
                    "El valor es idéntico en todos los periodos. No hay nada que "
                    "aprender: el problema está en cómo se registra el dato."
                ),
            ),
            seed=SEED,
        )

    mat = F.entrenable(F.build(df, serie.grain, horizon))
    cols = F.feature_names(mat)
    X = _matriz(mat, cols)
    y = mat["y"].to_numpy().astype(float)
    fechas = mat["at"].to_list()

    sp = split_temporal(len(y))
    if not sp.ok:
        return TrainResult(
            slug=serie.id,
            profile=perfil,
            verdict=Verdict(
                approved=False,
                reason=(
                    f"Quedan {len(y)} casos utilizables tras construir los rezagos, y no "
                    f"alcanzan para partir el histórico en entrenar, elegir y medir sin "
                    f"que el resultado sea azar."
                ),
            ),
            seed=SEED,
        )

    Xtr, ytr = X[sp.train], y[sp.train]
    Xva, yva = X[sp.val], y[sp.val]
    Xte, yte = X[sp.test], y[sp.test]

    # ── La línea base: se elige la MÁS FUERTE sobre validación ───────────
    mejor_base = None
    for b in _baselines(cols):
        if hasattr(b, "fit"):
            b.fit(Xtr, ytr)
        err = float(np.mean(np.abs(b.predict(Xva) - yva)))
        if mejor_base is None or err < mejor_base[1]:
            mejor_base = (b, err)
    base_obj, base_err = mejor_base  # type: ignore[misc]

    # ── Los competidores ─────────────────────────────────────────────────
    familias = FORECASTERS
    if forced:
        f = family_by_id(forced)
        if f is None:
            return TrainResult(
                slug=serie.id,
                profile=perfil,
                verdict=Verdict(approved=False, reason=f"No existe la familia «{forced}»."),
                seed=SEED,
            )
        familias = [f]

    tabla: list[Candidate] = []
    ganador = None

    # ¿Hay tendencia? Decide si los modelos que no extrapolan compiten también
    # en su versión SIN TENDENCIA. Ver `Detrended`.
    hay_tendencia = _tiene_tendencia(df)
    col_t = cols.index("t") if "t" in cols else None

    for fam in familias:
        if len(ytr) < fam.min_rows:
            tabla.append(
                Candidate(
                    algorithm=fam.id,
                    label=fam.label,
                    val_error=float("inf"),
                    fitted=False,
                    skipped_reason=(
                        f"necesita {fam.min_rows} periodos de entrenamiento y hay {len(ytr)}"
                    ),
                )
            )
            continue

        # Cada configuración compite tal cual y, si la serie tiene tendencia y
        # la familia no sabe extrapolar, también sin tendencia. Son dos
        # candidatos distintos y se anotan como tales: al final hay que poder
        # decir cuál ganó, porque el que se guarda no es el mismo objeto.
        variantes: list[tuple[bool, str]] = [(False, fam.label)]
        if hay_tendencia and not fam.extrapolates and col_t is not None:
            variantes.append((True, f"{fam.label} sin tendencia"))

        for params in fam.grid:
            for destendenciar, etiqueta in variantes:
                try:
                    modelo = fam.build(params)
                    if destendenciar:
                        modelo = Detrended(modelo, col_t)  # type: ignore[arg-type]
                    modelo.fit(Xtr, ytr)
                    err = float(np.mean(np.abs(modelo.predict(Xva) - yva)))
                except Exception as e:  # noqa: BLE001
                    tabla.append(
                        Candidate(
                            algorithm=fam.id,
                            label=etiqueta,
                            params=params,
                            val_error=float("inf"),
                            fitted=False,
                            skipped_reason=f"falló al ajustar: {type(e).__name__}",
                        )
                    )
                    continue

                tabla.append(
                    Candidate(
                        algorithm=fam.id,
                        label=etiqueta,
                        params={**params, "detrended": destendenciar},
                        val_error=err,
                    )
                )
                # `<` estricto: en empate gana el primero, y `FORECASTERS` va de
                # lo simple a lo complejo. La sencillez desempata.
                #
                # `ganador` es (familia, params, error, destendenciar, etiqueta):
                # el error es el TERCERO. Compararlo contra el segundo reventaba
                # con «float < dict», y solo cuando ya había pasado un candidato.
                if ganador is None or err < ganador[2]:
                    ganador = (fam, params, err, destendenciar, etiqueta)

    # La línea base también entra a la tabla: es lo que permite ver de un
    # vistazo si valió la pena todo lo demás.
    tabla.append(
        Candidate(
            algorithm=base_obj.id,
            label=f"{base_obj.label} (línea base)",
            val_error=base_err,
        )
    )
    tabla.sort(key=lambda c: c.val_error)

    if ganador is None:
        return TrainResult(
            slug=serie.id,
            profile=perfil,
            leaderboard=tabla,
            verdict=Verdict(
                approved=False,
                reason=(
                    "Ninguna familia alcanzó su mínimo de datos. La capacidad está "
                    "inscrita esperando historia, que es distinto de estar rota."
                ),
            ),
            seed=SEED,
        )

    fam, params, val_err, destendenciar, etiqueta = ganador

    # ── La medición. El tramo de prueba se estrena AQUÍ ───────────────────
    #
    # Se reajusta con entrenamiento + validación: una vez elegida la forma del
    # modelo, retacearle datos para ajustarlo no protege de nada.
    Xfit = X[: sp.val.stop]
    yfit = y[: sp.val.stop]
    def armar():
        m = fam.build(params)
        return Detrended(m, col_t) if destendenciar and col_t is not None else m

    final = armar()
    final.fit(Xfit, yfit)

    if hasattr(base_obj, "fit"):
        base_obj.fit(Xfit, yfit)

    bt = measure(
        final.predict(Xte),
        base_obj.predict(Xte),
        yte,
        baseline_name=base_obj.label,
        tol=serie.default_tolerance,
        tol_kind=serie.tolerance_kind,
        n_train=len(ytr),
        n_val=len(yva),
        cutoff=datetime.combine(fechas[sp.test.start], datetime.min.time()),
        horizon=horizon,
    )
    ver = verdict_for(bt, serie.unit, serie.default_tolerance, serie.tolerance_kind)

    # ── Aviso de extrapolación ───────────────────────────────────────────
    #
    # Un ganador que no sabe salir del rango histórico, sobre una serie que
    # crece, va a subestimar sistemáticamente el futuro. Se dice aunque el
    # veredicto sea aprobado: es información que cambia cómo se lee el número.
    if not fam.extrapolates and not destendenciar and hay_tendencia:
        perfil.warnings.append(
            f"El ganador ({etiqueta}) no extrapola: parte por umbrales, así que su "
            f"pronóstico queda acotado por lo ya visto, y esta serie crece. Compitió "
            f"también su versión sin tendencia y perdió, así que el número es el mejor "
            f"que hay — pero espera que subestime los periodos más altos."
        )

    # El que se GUARDA se reentrena con TODO el histórico: el corte servía para
    # medir, no para producir el que va a predecir mañana.
    guardado = armar()
    guardado.fit(X, y)

    return TrainResult(
        slug=serie.id,
        profile=perfil,
        winner=Candidate(
            algorithm=fam.id,
            label=etiqueta,
            params={**params, "detrended": destendenciar},
            val_error=val_err,
        ),
        leaderboard=tabla,
        backtest=bt,
        verdict=ver,
        model_blob=base64.b64encode(
            pickle.dumps({"model": guardado, "cols": cols, "grain": serie.grain,
                          "horizon": horizon, "family": fam.id})
        ).decode(),
        trained_up_to=datetime.combine(fechas[-1], datetime.min.time()),
        seed=SEED,
    )


def _tiene_tendencia(df: pl.DataFrame) -> bool:
    """¿La serie crece o decrece de forma sostenida?

    Se compara el primer tercio con el último por MEDIANA y no por media: un
    solo mes extraordinario mueve la media del tercio y haría aparecer una
    tendencia donde solo hubo un pedido grande.
    """
    v = df["value"].to_numpy().astype(float)
    if len(v) < 12:
        return False
    k = len(v) // 3
    ini = float(np.median(v[:k]))
    fin = float(np.median(v[-k:]))
    if ini == 0:
        return fin > 0
    return abs(fin - ini) / abs(ini) > 0.25
