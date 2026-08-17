"""Que el clasificador enruta bien, y que sabe callar cuando no sabe.

Los casos vienen de dos sitios: la especificación de la capa —los ejemplos que
definieron la taxonomía— y los fallos encontridos al construirla. Los segundos
son los que importan más: cada uno es un error real que ya se cometió, y una
prueba que no cubre un fallo pasado deja que vuelva.
"""

from app.classify import classify
from app.intents import Intent, Level

# ── De la especificación ──────────────────────────────────────────────────

ESPECIFICACION = [
    ("¿Cuánto inventario tengo del producto X?", Intent.QUERY),
    ("¿Cuándo me voy a quedar sin inventario del producto X?", Intent.FORECAST),
    ("¿Cuánto debería pedir del producto X?", Intent.RECOMMENDATION),
    ("¿Qué pasa si aumento el precio 10%?", Intent.SIMULATION),
    ("Genera una orden de compra para los productos que necesitamos.", Intent.ACTION),
    ("¿Por qué bajaron las ventas?", Intent.DIAGNOSIS),
    ("¿Qué productos tienen inventario anormal?", Intent.ANOMALY),
    ("¿Cuál es el descuento óptimo?", Intent.OPTIMIZATION),
]

# ── Del negocio real de este ERP ──────────────────────────────────────────

NEGOCIO = [
    ("¿Cuánto nos van a facturar los proveedores el mes que viene?", Intent.FORECAST),
    ("¿Cuántas horas va a llevar esta visita?", Intent.FORECAST),
    ("¿Cada cuánto se consume esta refacción?", Intent.QUERY),
    ("¿Qué clientes tienen pagos vencidos?", Intent.QUERY),
    ("¿Qué clientes van a dejar de comprar?", Intent.FORECAST),
    ("¿A quién debería contactar esta semana?", Intent.RECOMMENDATION),
    ("Muéstrame los tickets abiertos", Intent.QUERY),
]

# ── Fallos ya cometidos, que no pueden volver ─────────────────────────────

REGRESIONES = [
    # «anormal» no casa con el prefijo `anomal`: una letra dejaba la intención
    # sin detectar en la forma más común de decirlo en español.
    ("¿Qué refacciones tienen inventario anormal?", Intent.ANOMALY),
    # «cuándo» pide futuro, y se pedían verbos concretos que no cubrían la
    # forma más natural de preguntarlo.
    ("¿Cuándo vuelve a necesitar atención este equipo?", Intent.FORECAST),
    ("¿Cuándo toca el mantenimiento del HPLC?", Intent.FORECAST),
    # …salvo cuando el verbo está en pasado, que entonces es un dato guardado.
    ("¿Cuándo se cerró el ticket EVO-000412?", Intent.QUERY),
    ("¿Cuándo se pagó esa factura?", Intent.QUERY),
    ("¿Cuánto se facturó el año pasado?", Intent.QUERY),
]


def test_clasifica_la_especificacion():
    for pregunta, esperado in ESPECIFICACION:
        assert classify(pregunta).primary_intent is esperado, pregunta


def test_clasifica_el_negocio():
    for pregunta, esperado in NEGOCIO:
        assert classify(pregunta).primary_intent is esperado, pregunta


def test_no_reincide():
    for pregunta, esperado in REGRESIONES:
        assert classify(pregunta).primary_intent is esperado, pregunta


def test_una_recomendacion_arrastra_el_pronostico():
    """Sin pronóstico debajo, una recomendación es una corazonada."""
    c = classify("¿Cuánto debería pedir del producto X?")
    assert Intent.FORECAST in c.secondary_intents


def test_una_consulta_no_pide_modelo():
    """La defensa central de la capa: no se usa ML cuando hay respuesta exacta."""
    c = classify("¿Cuánto inventario tengo del producto X?")
    assert c.requires_ml is False
    assert c.level is Level.QUERY


def test_calla_cuando_no_sabe():
    """Un clasificador que siempre responde no es fiable cuando responde."""
    c = classify("aguacate bicicleta")
    assert c.clarification_required is True
    assert c.confidence == 0.0


def test_lo_que_no_sabe_ejecutar_lo_dice():
    """Entender y poder hacer son cosas distintas; confundirlas miente."""
    c = classify("¿Cuál es el descuento óptimo?")
    assert c.primary_intent is Intent.OPTIMIZATION
    assert c.supported is False
    assert c.unsupported_reason


def test_el_modulo_desambigua_el_dominio():
    """La pista más barata: quien pregunta desde Compras pregunta de compras."""
    sin = classify("¿cómo viene esto el mes que viene?")
    con = classify("¿cómo viene esto el mes que viene?", module="compras")
    assert con.business_domain != sin.business_domain


def test_una_accion_exige_autorizacion():
    c = classify("Genera una orden de compra para lo que falta")
    assert c.requires_erp_action is True
