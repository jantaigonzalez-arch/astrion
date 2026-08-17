"""El examen: partición temporal, línea base honesta y veredicto.

Aquí vive todo lo que hace creíble a un número de esta capa, y nada de esto
depende de qué modelo se esté evaluando. Que esté separado del buscador es lo
que permite añadir familias nuevas sin relajar ninguna defensa.

── LA PARTICIÓN ES EN TRES ────────────────────────────────────────────────

  entrenar 55 %  ·  elegir 15 %  ·  medir 30 %

Y el tramo de MEDIR se toca UNA sola vez, con el ganador ya decidido. No es
purismo: con cinco familias y sus configuraciones se prueban decenas de
candidatos, y si el ganador se eligiera mirando el tramo de prueba, la
probabilidad de que alguno acierte por azar deja de ser teórica.

El corte es TEMPORAL, nunca aleatorio. Un split al azar sobre una serie deja
que el modelo se entrene con el futuro y produce una métrica excelente que se
desploma en producción.

── EL LISTÓN DE ACIERTOS, CORREGIDO ───────────────────────────────────────

La versión anterior de este examen exigía «acertar el 50 % de las veces dentro
del margen», un número absoluto. Estaba mal, y se demostró midiendo: un
fenómeno cuya dispersión propia es alta tiene un TECHO de aciertos que ningún
modelo pasa —con un coeficiente de variación de 0,5, el techo dentro de ±25 %
ronda el 41 %—. Exigir un 50 % ahí es exigir lo imposible y culpar al modelo.

Peor todavía: era incoherente. El error se juzgaba contra una línea base y los
aciertos contra una constante, así que dos modelos que aportaban lo mismo —+8 y
+9 puntos de acierto sobre no tener modelo— recibían veredictos opuestos según
lo disperso que fuera el fenómeno, no según lo bueno que fuera el modelo.

Ahora las dos condiciones se miden contra el MISMO rival:

  1 · el error tiene que bajar al menos un 5 % respecto de la línea base
  2 · y tiene que haber evidencia de que cambia decisiones: o los aciertos
      suben al menos 5 puntos respecto de la línea base, o el error baja tanto
      —20 % o más— que el umbral se queda corto para medirlo

La segunda condición admite dos evidencias porque «aciertos dentro del margen»
es una métrica de UMBRAL, y los umbrales son ciegos a lo que no cruza la línea.
Medido: en cuentas por pagar el modelo bajó el error un 29,8 % y los aciertos
quedaron en 42 % contra 42 %, porque el 42 % era el techo del fenómeno con ese
margen. Rechazarlo ahí habría sido rechazar por no poder medir.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..contracts import Backtest, Verdict

#: Margen mínimo de mejora en error, en porcentaje.
MIN_IMPROVEMENT = 5.0
#: Margen mínimo de mejora en aciertos, en PUNTOS sobre la línea base.
MIN_HIT_GAIN = 5.0

#: Por encima de aquí, el margen no distingue nada y la condición de aciertos
#: se vuelve vacía. Ver `verdict_for`.
SATURADO = 95.0

#: Reducción de error que basta por sí sola, aunque los aciertos no se muevan.
#:
#: Veinte por ciento no es una cifra redonda elegida por gusto: es el umbral por
#: encima del cual la mejora ya cambia decisiones operativas —un pronóstico de
#: compra que se equivoca un quinto menos mueve el punto de reorden— y por debajo
#: del cual todavía puede ser ruido del tramo de prueba.
BIG_IMPROVEMENT = 20.0
#: Casos mínimos por tramo. Por debajo, el resultado es anécdota.
MIN_VAL = 8
MIN_TEST = 12


@dataclass(frozen=True)
class Split:
    """Los tres tramos, por índice. Contiguos y en orden temporal."""

    train: slice
    val: slice
    test: slice
    n: int

    @property
    def ok(self) -> bool:
        return (
            self.val.stop - self.val.start >= MIN_VAL
            and self.test.stop - self.test.start >= MIN_TEST
        )


def split_temporal(n: int) -> Split:
    a = int(n * 0.55)
    b = int(n * 0.70)
    return Split(slice(0, a), slice(a, b), slice(b, n), n)


def within(error: np.ndarray, real: np.ndarray, tol: float, kind: str) -> float:
    """Qué fracción cayó dentro del margen, en porcentaje.

    Con margen RELATIVO se mide sobre el valor REAL y no sobre el estimado: si
    se midiera contra el estimado, un modelo que dispara alto se ensancharía su
    propia ventana y se aprobaría solo.
    """
    if kind == "absolute":
        dentro = error <= tol
    else:
        limite = np.abs(real) * (tol / 100.0)
        # Un real de cero no admite margen relativo: cualquier error es
        # infinitamente grande en proporción. Se exige exactitud, que es la
        # lectura correcta de «este mes no hubo nada».
        dentro = error <= limite
    return float(np.mean(dentro) * 100.0)


def mae(pred: np.ndarray, real: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - real)))


def measure(
    pred: np.ndarray,
    base: np.ndarray,
    real: np.ndarray,
    *,
    baseline_name: str,
    tol: float,
    tol_kind: str,
    n_train: int,
    n_val: int,
    cutoff,
    horizon: int,
) -> Backtest:
    e_modelo = np.abs(pred - real)
    e_base = np.abs(base - real)
    m = float(np.mean(e_modelo))
    b = float(np.mean(e_base))

    return Backtest(
        mae=m,
        baseline_mae=b,
        baseline_name=baseline_name,
        improvement_pct=0.0 if b == 0 else (b - m) / b * 100.0,
        within_tolerance_pct=within(e_modelo, real, tol, tol_kind),
        baseline_within_tolerance_pct=within(e_base, real, tol, tol_kind),
        n_train=n_train,
        n_val=n_val,
        n_test=len(real),
        cutoff=cutoff,
        horizon=horizon,
    )


def verdict_for(b: Backtest, unit: str, tol: float, tol_kind: str) -> Verdict:
    """Aprobar o no, y por qué. Ver la cabecera del módulo."""
    margen = f"±{tol:g} %" if tol_kind == "relative" else f"±{tol:g} {unit}".strip()
    gan_aciertos = b.within_tolerance_pct - b.baseline_within_tolerance_pct

    if b.improvement_pct < MIN_IMPROVEMENT:
        return Verdict(
            approved=False,
            reason=(
                f"El error baja {b.improvement_pct:.1f} % respecto de «{b.baseline_name}», "
                f"por debajo del {MIN_IMPROVEMENT:g} % exigido. Con estos datos la "
                f"respuesta ingenua funciona igual de bien y no hay nada que mantener."
            ),
        )

    # ── El margen saturado ───────────────────────────────────────────────
    #
    # Cuando la línea base ya acierta el 95 % o más, la condición de aciertos
    # deja de significar nada: no hay puntos que ganar porque no quedan. Exigir
    # +5 ahí rechaza modelos útiles por una razón puramente aritmética, y se
    # encontró midiendo: «horas de campo cada mes» bajaba el error un 18 % y
    # quedaba rechazada con modelo y línea base al 100 % dentro de ±20 %.
    #
    # Es el fallo espejo del que arregló este archivo. Un margen demasiado
    # ESTRECHO hace que nadie llegue al listón; uno demasiado HOLGADO hace que
    # todos lleguen, y en los dos casos el listón deja de medir al modelo y
    # empieza a medir el margen. Así que cuando satura se decide con el error, y
    # se dice que el margen no discrimina — que es lo que hay que corregir.
    if b.baseline_within_tolerance_pct >= SATURADO:
        return Verdict(
            approved=True,
            reason=(
                f"Baja el error un {b.improvement_pct:.1f} % respecto de "
                f"«{b.baseline_name}». Ojo con el margen: dentro de {margen} aciertan "
                f"casi siempre las dos —{b.within_tolerance_pct:.0f} % el modelo y "
                f"{b.baseline_within_tolerance_pct:.0f} % la respuesta ingenua—, así que "
                f"ese porcentaje no distingue nada y conviene apretarlo para que vuelva "
                f"a decir algo. Medido sobre {b.n_test} periodos posteriores al corte."
            ),
        )

    # ── Mejora grande que el umbral no sabe ver ──────────────────────────
    #
    # «Aciertos dentro del margen» es una métrica de UMBRAL, y los umbrales son
    # ciegos a las mejoras que no cruzan la línea: un modelo puede reducir un
    # 30 % el error medio dejando casi todos los fallos del mismo lado del
    # margen, y el porcentaje no se mueve un punto.
    #
    # Pasó, y midiéndolo se entendió: en cuentas por pagar el modelo bajó el
    # error un 29,8 % y los aciertos quedaron en 42 % contra 42 %. No era que el
    # modelo no aportara — era que el 42 % ES EL TECHO de ese fenómeno con ese
    # margen, así que ni el modelo perfecto lo movería.
    #
    # Por eso la segunda condición admite dos evidencias distintas de que el
    # modelo cambia decisiones: que acierte más veces, o que el error baje tanto
    # que el umbral se quede corto para medirlo. Lo que NO se admite es aprobar
    # sin ninguna de las dos.
    if gan_aciertos < MIN_HIT_GAIN and b.improvement_pct < BIG_IMPROVEMENT:
        return Verdict(
            approved=False,
            reason=(
                f"Baja el error un {b.improvement_pct:.1f} %, pero acierta dentro de "
                f"{margen} el {b.within_tolerance_pct:.0f} % de las veces contra el "
                f"{b.baseline_within_tolerance_pct:.0f} % de «{b.baseline_name}»: "
                f"{gan_aciertos:+.0f} puntos. Mejorar el promedio sin mejorar cuántas "
                f"veces el número sirve para decidir no cambia ninguna decisión."
            ),
        )

    if gan_aciertos < MIN_HIT_GAIN:
        return Verdict(
            approved=True,
            reason=(
                f"Baja el error un {b.improvement_pct:.1f} % respecto de "
                f"«{b.baseline_name}», que es mejora suficiente por sí sola. Los "
                f"aciertos dentro de {margen} no se mueven —{b.within_tolerance_pct:.0f} % "
                f"contra {b.baseline_within_tolerance_pct:.0f} %— y eso suele significar "
                f"que ese margen ya está en el techo de lo que el fenómeno permite: el "
                f"modelo se equivoca MENOS, no menos veces. Medido sobre {b.n_test} "
                f"periodos posteriores al corte."
            ),
        )

    return Verdict(
        approved=True,
        reason=(
            f"Baja el error un {b.improvement_pct:.1f} % respecto de «{b.baseline_name}» "
            f"y acierta dentro de {margen} el {b.within_tolerance_pct:.0f} % de las veces, "
            f"{gan_aciertos:+.0f} puntos sobre la respuesta ingenua. "
            f"Medido sobre {b.n_test} periodos posteriores al corte."
        ),
    )
