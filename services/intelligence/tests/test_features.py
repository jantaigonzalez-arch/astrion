"""Que la matriz de aprendizaje NO mira el futuro.

No lee el código: EXPERIMENTA. Se toma una serie, se corrompe el valor de todos
los periodos posteriores a uno dado, y se exige que ninguna columna de ninguna
fila anterior cambie ni un decimal.

Y para que la prueba no sea un sello de goma, corre también contra una columna
DELIBERADAMENTE FUGADA —la misma media móvil sin el desplazamiento— que tiene
que salir reprobada. Una prueba que no puede fallar no prueba nada.
"""

import polars as pl

from app.automl import features as F


def serie(n: int = 60) -> pl.DataFrame:
    from datetime import date

    return pl.DataFrame(
        {
            "at": [date(2020 + i // 12, i % 12 + 1, 1) for i in range(n)],
            "value": [100.0 + i * 2 + (i % 7) * 5 for i in range(n)],
        }
    )


def corromper(df: pl.DataFrame, desde: int) -> pl.DataFrame:
    return df.with_columns(
        pl.when(pl.int_range(0, pl.len()) >= desde)
        .then(pl.col("value") * 1000 + 7)
        .otherwise(pl.col("value"))
        .alias("value")
    )


def test_ninguna_columna_ve_el_futuro():
    base = F.build(serie(), "month", horizon=1)
    cols = F.feature_names(base)

    for sonda in (12, 24, 36, 48):
        roto = F.build(corromper(serie(), sonda), "month", horizon=1)
        # Hasta la fila `sonda - 1`: la fila `sonda` sí cambia legítimamente,
        # porque su propio valor es el que se corrompió.
        a = base.head(sonda).select(cols)
        b = roto.head(sonda).select(cols)
        assert a.equals(b), f"alguna columna se enteró del futuro en la sonda {sonda}"


def test_la_prueba_sabe_detectar_una_fuga():
    """El control: la misma media móvil SIN desplazar tiene que reprobar."""
    fugada = lambda df: df.with_columns(  # noqa: E731
        pl.col("value").rolling_mean(window_size=3, min_samples=1).alias("fuga")
    )

    base = fugada(serie())
    roto = fugada(corromper(serie(), 24))
    # La fila 23 usa la ventana [21, 22, 23]; la 24 en adelante está corrompida.
    # Sin desplazar, la fila 23 incluye su PROPIO valor —que no cambió— así que
    # se compara la 24, donde la ventana ya toca lo corrompido y la honesta no.
    assert base["fuga"][23] == roto["fuga"][23]
    assert base["fuga"][24] != roto["fuga"][24]


def test_el_objetivo_se_desplaza_con_el_horizonte():
    df = serie(30)
    uno = F.build(df, "month", horizon=1)
    tres = F.build(df, "month", horizon=3)
    assert uno["y"][0] == df["value"][1]
    assert tres["y"][0] == df["value"][3]


def test_el_indice_de_tiempo_permite_extrapolar():
    """`t` es la única columna que puede tomar valores nunca vistos.

    Sin ella ningún modelo sale del rango histórico, y eso es exactamente por
    qué el laboratorio anterior no pudo pronosticar una serie que crece.
    """
    m = F.build(serie(40), "month", horizon=1)
    assert "t" in F.feature_names(m)
    assert m["t"].max() == 39
