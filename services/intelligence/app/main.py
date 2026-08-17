"""El borde HTTP de la capa de inteligencia.

── UN MOTOR SIN ESTADO ────────────────────────────────────────────────────

Este servicio no guarda nada. Lee el histórico del esquema de la empresa,
entrena, devuelve el modelo serializado y se olvida. El ERP lo guarda en el
esquema del inquilino, junto a sus datos.

No es una preferencia arquitectónica: es lo que hace que el servicio se pueda
reiniciar, escalar o reemplazar sin que ninguna empresa pierda nada, y lo que
mantiene la promesa que el ERP ya le hace al cliente — «tus modelos viven donde
viven tus datos, y un respaldo de tu base se los lleva consigo». Si los modelos
vivieran aquí, esa frase dejaría de ser verdad el día que se despliegue.

── LO QUE NO EXPONE ───────────────────────────────────────────────────────

No hay endpoint de acción. La taxonomía tiene una intención ACTION y esta capa
la CLASIFICA, pero no la ejecuta: escribir en el ERP es del ERP, detrás de sus
permisos y su validación. Un servicio de modelos con permiso de escritura sobre
la base del cliente es un riesgo que no compra nada.

── LA RED ─────────────────────────────────────────────────────────────────

Sin puerto publicado en el compose: solo lo alcanzan los contenedores de la
red interna. La autenticación es de red y no de token porque el único cliente
es el propio ERP; el día que haya otro, hará falta un token y este comentario
sobra.
"""

from __future__ import annotations

import base64
import pickle

from fastapi import FastAPI, HTTPException

from . import catalog as C
from . import data as D
from .automl import project as P
from .automl.search import buscar_forecast
from .classify import classify
from .contracts import (
    ClassifyRequest,
    Classification,
    ForecastRequest,
    ForecastResult,
    TrainRequest,
    TrainResult,
)

app = FastAPI(
    title="Astraion · capa de inteligencia",
    version="0.1.0",
    summary="Clasificación de intención, AutoML y pronóstico sobre el ERP.",
)


@app.get("/salud")
def salud() -> dict[str, object]:
    """Vivo y con qué. El compose lo usa como healthcheck."""
    return {
        "ok": True,
        "series": len(C.SERIES),
        "sujetos": len(C.SUJETOS),
        "modulos": [m.id for m in C.MODULOS],
    }


# ═══════════════════════════════════════════════════════════════════
#  1 · Entender antes de ejecutar
# ═══════════════════════════════════════════════════════════════════


@app.post("/clasificar", response_model=Classification)
def clasificar(req: ClassifyRequest) -> Classification:
    """Qué quiere saber la persona, y con qué método se contesta.

    Se puede llamar SOLA, sin ejecutar nada. Es lo que permite enseñarle al
    usuario cómo se interpretó su pregunta y dejarle corregirla antes de que
    nadie gaste un entrenamiento.
    """
    return classify(req.question, req.module)


# ═══════════════════════════════════════════════════════════════════
#  2 · El catálogo: qué se puede preguntar en cada módulo
# ═══════════════════════════════════════════════════════════════════


@app.get("/catalogo")
def catalogo() -> dict[str, object]:
    """La ontología aplanada para la pantalla de configuración.

    Viaja `safe_because` de cada señal porque el constructor lo ENSEÑA: una
    señal se ofrece con su justificación al lado, para que quien arma la
    pregunta sepa por qué ese dato es legítimo y no tenga que confiar a ciegas.

    No viaja NADA de SQL. Son las piezas con las que se compila una consulta, y
    mandarlas al navegador sería mandar el motor entero para que alguien elija
    de un desplegable.
    """
    return {
        "modulos": [
            {
                "id": m.id,
                "label": m.label,
                "series": [
                    {
                        "id": s.id,
                        "label": s.label,
                        "question": s.question,
                        "unit": s.unit,
                        "grain": s.grain,
                        "task": "forecast",
                        "tolerance": s.default_tolerance,
                        "tolerance_kind": s.tolerance_kind,
                        "min_periods": s.min_periods,
                        "por_entidad": s.entity_sql is not None,
                    }
                    for s in C.SERIES
                    if s.id in m.series
                ],
                "sujetos": [
                    {
                        "id": sj.id,
                        "label": sj.label,
                        "repeats": sj.repeats,
                        "targets": [
                            {
                                "id": t.id,
                                "label": t.label,
                                "unit": t.unit,
                                "task": t.task,
                                "tolerance": t.default_tolerance,
                                "tolerance_kind": t.tolerance_kind,
                            }
                            for t in sj.targets
                        ],
                        "signals": [
                            {"id": g.id, "label": g.label, "safe_because": g.safe_because}
                            for g in sj.signals
                        ],
                    }
                    for sj in C.SUJETOS
                    if sj.id in m.sujetos
                ],
            }
            for m in C.MODULOS
        ],
        "familias": [
            {"id": f.id, "label": f.label, "extrapola": f.extrapolates,
             "explicable": f.explains, "minimo": f.min_rows}
            for f in _familias()
        ],
    }


def _familias():
    from .automl.registry import FORECASTERS

    return FORECASTERS


# ═══════════════════════════════════════════════════════════════════
#  3 · Perfilar, entrenar, pronosticar
# ═══════════════════════════════════════════════════════════════════


@app.get("/perfil/{tenant}/{serie_id}")
def perfil(tenant: str, serie_id: str):
    """Qué hay en los datos, sin entrenar.

    Existe como llamada aparte porque es lo primero que hay que mirar y lo
    último que se mira: la mitad de los veredictos negativos se explican aquí
    —seis periodos de historia, un valor constante, la mitad de los meses en
    cero— y verlo antes ahorra un entrenamiento que iba a salir mal.
    """
    from .automl.profile import profile_series

    s = C.serie_por_id(serie_id)
    if s is None:
        raise HTTPException(404, f"No existe la serie «{serie_id}».")
    return profile_series(D.serie(tenant, s), s)


@app.post("/entrenar", response_model=TrainResult)
def entrenar(req: TrainRequest) -> TrainResult:
    """Busca el mejor modelo para una pregunta configurada y lo evalúa.

    No escribe nada, ni aquí ni en el ERP: devuelve el veredicto y el modelo
    serializado, y quien decide si se promueve es el ERP. Un modelo rechazado se
    devuelve igual —con su motivo— porque saber que una pregunta no se puede
    responder con estos datos es información valiosa: evita que alguien lo
    reintente en seis meses y permite comparar cuando el histórico crezca.
    """
    q = req.question
    if q.task != "forecast":
        raise HTTPException(
            501,
            f"La tarea «{q.task}» está declarada en el contrato y todavía no "
            f"implementada. Hoy esta capa entrena pronóstico de series.",
        )

    s = C.serie_por_id(q.subject)
    if s is None:
        raise HTTPException(404, f"No existe la serie «{q.subject}».")

    df = D.serie(req.tenant, s)
    return buscar_forecast(s, df, horizon=q.horizon, forced=q.algorithm)


@app.post("/pronosticar", response_model=ForecastResult)
def pronosticar(req: ForecastRequest) -> ForecastResult:
    """Extiende la serie hacia el futuro con un modelo ya entrenado.

    El modelo llega en la petición y no se busca aquí: el servicio no guarda
    nada. Ver la cabecera del módulo.
    """
    s = C.serie_por_id(req.serie_id)
    if s is None:
        raise HTTPException(404, f"No existe la serie «{req.serie_id}».")

    try:
        cargado = pickle.loads(base64.b64decode(req.model_blob))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Modelo ilegible: {type(e).__name__}") from e

    df = D.serie(req.tenant, s)
    if df.height == 0:
        raise HTTPException(409, "No hay histórico con el que arrancar la proyección.")

    puntos = P.project(
        cargado["model"],
        cargado["cols"],
        df,
        cargado["grain"],
        req.periods,
        mae=req.mae,
    )
    return ForecastResult(
        slug=req.serie_id,
        points=puntos,
        history=P.history_points(df),
        model=cargado.get("family", "desconocido"),
    )
