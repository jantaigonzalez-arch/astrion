"""El plano de datos: del esquema de una empresa a un dataframe de Polars.

── AISLAMIENTO ────────────────────────────────────────────────────────────

Cada empresa vive en su propio esquema de Postgres y este módulo fija
`search_path` a ese esquema y nada más. No es una comodidad para no escribir
el prefijo: es que las consultas del catálogo nombran tablas SIN esquema, así
que una consulta compilada para una empresa es literalmente incapaz de leer la
de otra. No hay que acordarse de filtrar por inquilino porque no existe forma
de nombrar el esquema ajeno.

`SET LOCAL` y no `SET`: se deshace al terminar la transacción, así que una
conexión devuelta al pool no puede llevarse el esquema de la empresa anterior.
Ese fallo —una conexión reutilizada con el `search_path` de otro inquilino— es
de los que no dan error: dan los datos equivocados.

── POR QUÉ POLARS ─────────────────────────────────────────────────────────

Mismo motor Rust que el lado de Node (`nodejs-polars`), mismo parquet, mismas
semánticas de ventana. Los dos extremos del sistema hablan del mismo
dataframe, y eso es lo que evita que el conjunto con el que se entrena y el
que se sirve se separen sin que nadie lo note.

Y una nota honesta sobre velocidad: a este tamaño Polars NO es más rápido que
aritmética a mano —se midió, y pierde por marshalling en conjuntos de cientos
de filas—. Entra por la FORMA de las expresiones (ventanas por entidad,
desplazamientos, agregados temporales) y porque es el mismo motor a los dos
lados. Defenderlo por velocidad sería falso.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

import polars as pl
import psycopg

from .catalog import Serie, Signal, Sujeto, Target


def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("Falta DATABASE_URL en el entorno del servicio.")
    return url


def schema_for(tenant: str) -> str:
    """El esquema de una empresa a partir de su identificador.

    Se valida el formato en vez de confiar: el nombre llega por HTTP desde el
    ERP, y va a acabar interpolado en un `SET LOCAL search_path`, que no admite
    parámetros. Un slug con una comilla dentro sería inyección directa.
    """
    slug = tenant.strip().lower()
    if slug.startswith("tenant_"):
        slug = slug[len("tenant_") :]
    if not slug or not all(c.isalnum() or c == "_" for c in slug):
        raise ValueError(f"Identificador de empresa inválido: {tenant!r}")
    return f"tenant_{slug}"


@contextmanager
def tenant_cursor(tenant: str) -> Iterator[psycopg.Connection]:
    """Una conexión con el `search_path` puesto en el esquema de esa empresa."""
    esquema = schema_for(tenant)
    with psycopg.connect(dsn()) as conn:
        with conn.cursor() as cur:
            # Sin `public` detrás a propósito: si una consulta necesitara una
            # tabla del plano de control, tiene que decirlo con el prefijo. Un
            # respaldo silencioso a `public` es cómo una consulta de negocio
            # acaba leyendo la tabla compartida sin que nadie lo advierta.
            cur.execute(f"set local search_path to {esquema}")
        yield conn


def query(tenant: str, sql: str) -> pl.DataFrame:
    """Corre una consulta en el esquema de la empresa y devuelve un dataframe."""
    with tenant_cursor(tenant) as conn:
        return pl.read_database(sql, connection=conn, infer_schema_length=None)


# ═══════════════════════════════════════════════════════════════════
#  Compilación desde el catálogo
# ═══════════════════════════════════════════════════════════════════


def compile_panel(
    sujeto: Sujeto, target: Target, signals: list[Signal]
) -> str:
    """El histórico de un sujeto: una fila por caso, con ancla, llave y señales.

    El objetivo se calcula en la capa interna y se filtra en la externa. No es
    cosmética: permite que `keep` se escriba una sola vez en términos del alias
    `target` en vez de repetir la subconsulta entera en cada condición.
    """
    cols = ",\n             ".join(
        f"({s.sql}) as {s.id}" for s in signals
    )
    coma = "," if signals else ""
    return f"""
      select * from (
        select {sujeto.anchor} as at,
               ({sujeto.key}) as subject_key,
               {cols}{coma}
               ({target.sql})::float8 as target
          from {sujeto.frm}
         where {sujeto.where}
      ) x
      where target is not null and {target.keep}
      order by at
    """


def compile_serving(sujeto: Sujeto, signals: list[Signal], key: str) -> str:
    """Las señales de un caso VIVO, con exactamente las mismas expresiones.

    «Las mismas» es literal: se leen del mismo objeto `Signal` que compiló el
    histórico. Es la única forma de garantizar que el número que ve el modelo al
    aprender y el que ve al decidir salen del mismo cálculo — dos SQL parecidos
    escritos en dos sitios se separan a la tercera modificación.
    """
    cols = ",\n             ".join(f"({s.sql}) as {s.id}" for s in signals) or "1 as existe"
    return f"""
      select {cols}
        from {sujeto.frm}
       where {sujeto.where} and ({sujeto.key}) = %(key)s
       order by {sujeto.anchor} desc
       limit 1
    """


def panel(
    tenant: str, sujeto: Sujeto, target: Target, signals: list[Signal]
) -> pl.DataFrame:
    df = query(tenant, compile_panel(sujeto, target, signals))
    if df.height == 0:
        return df
    return df.with_columns(pl.col("at").cast(pl.Datetime))


def serie(tenant: str, s: Serie) -> pl.DataFrame:
    """Una serie temporal: `at` y `value`, una fila por periodo, sin huecos.

    Se recorta el periodo EN CURSO. Un mes a medias no es un mes flojo: es un
    mes que todavía no terminó, y dejarlo dentro le enseña al modelo que los
    últimos periodos siempre caen — con lo que el pronóstico del mes que viene
    sale sistemáticamente bajo. Es el error más común al pronosticar desde un
    ERP y el más difícil de ver, porque el histórico se ve perfecto.
    """
    df = query(tenant, s.sql)
    if df.height == 0:
        return df

    df = df.with_columns(pl.col("at").cast(pl.Date)).sort("at")
    corte = _inicio_del_periodo(datetime.now(), s.grain)
    return df.filter(pl.col("at") < corte)


def serie_por_entidad(tenant: str, s: Serie) -> pl.DataFrame:
    """La misma serie, abierta por entidad. Ver `Serie.entity_sql`."""
    if not s.entity_sql:
        return pl.DataFrame()
    df = query(tenant, s.entity_sql)
    if df.height == 0:
        return df
    df = df.with_columns(pl.col("at").cast(pl.Date)).sort(["key", "at"])
    corte = _inicio_del_periodo(datetime.now(), s.grain)
    return df.filter(pl.col("at") < corte)


def _inicio_del_periodo(cuando: datetime, grain: str):
    from datetime import date, timedelta

    d = cuando.date()
    if grain == "month":
        return date(d.year, d.month, 1)
    if grain == "week":
        return d - timedelta(days=d.weekday())
    return d


def rellenar(df: pl.DataFrame, grain: str) -> pl.DataFrame:
    """Completa los periodos ausentes con cero.

    Las series del catálogo ya vienen rellenas por SQL; esto es para las que
    llegan por entidad, donde generar el calendario de cada una en SQL sería
    un producto cartesiano de trescientas piezas por ciento veinte meses.

    Cero y no interpolación: un mes sin consumo es un mes sin consumo. Rellenar
    con la media inventa demanda que nunca existió, y sobre eso se calcula un
    punto de reorden que se compra de verdad.
    """
    if df.height == 0:
        return df
    every = {"month": "1mo", "week": "1w", "day": "1d"}[grain]
    return (
        df.upsample(time_column="at", every=every)
        .with_columns(pl.col("value").fill_null(0.0))
        .with_columns(pl.col("key").forward_fill() if "key" in df.columns else pl.lit(None))
    )
