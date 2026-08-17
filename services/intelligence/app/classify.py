"""De una pregunta en español a una intención y un método.

── POR QUÉ REGLAS Y NO UN MODELO DE LENGUAJE ──────────────────────────────

Por la misma regla que gobierna toda la capa: no se usa el método caro cuando
el barato contesta bien. Sería incoherente que el clasificador —cuyo trabajo
es impedir que se use ML sin necesidad— fuera él mismo una llamada a un LLM
por cada pregunta.

Y aquí las reglas ganan de verdad, no por ahorro:

  · El espacio es CERRADO. Ocho intenciones, diecisiete dominios. No es
    comprensión de lenguaje abierto, es enrutado.
  · Tiene que ser DETERMINISTA. La misma pregunta debe clasificar igual hoy y
    en marzo, o el usuario ve que su tablero cambió de método sin que él
    tocara nada.
  · Tiene que poder EXPLICARSE. `Classification.why` lleva las señales que
    dispararon. Con un LLM detrás, ese campo sería una racionalización.
  · No puede depender de una red ajena. Una clasificación que falla porque un
    proveedor está caído convierte toda la capa en opcional.

Cuando las reglas no alcanzan, la salida correcta NO es adivinar: es
`clarification_required`, que le devuelve la pregunta al usuario. Un
clasificador que siempre responde algo es un clasificador del que no te puedes
fiar cuando responde.

El enganche para un LLM queda declarado en `disambiguate()` y sin implementar:
el día que haga falta, entra donde las reglas se declaran vencidas, no antes.
"""

from __future__ import annotations

import re
import unicodedata

from .contracts import Classification
from .intents import Domain, Horizon, Intent, Level, floor_for, is_supported


def normalizar(texto: str) -> str:
    """Minúsculas y sin acentos.

    Sin esto, «cuánto» y «cuanto» son dos palabras distintas, y en un ERP
    mexicano la mitad de las preguntas se escriben sin acentos porque se
    teclean rápido. Es el fallo más tonto y más frecuente de un clasificador
    por reglas en español.
    """
    sin = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in sin if unicodedata.category(c) != "Mn")


# ── Señales por intención ─────────────────────────────────────────────────
#
# El orden de la lista NO importa; el peso sí. Una señal fuerte es una que
# casi nunca aparece en otra intención («que pasa si» es simulación y poco
# más). Una débil es compatible con varias y solo desempata.

Senal = tuple[re.Pattern[str], int]


def _s(patron: str, peso: int) -> Senal:
    return re.compile(patron), peso


SENALES: dict[Intent, list[Senal]] = {
    Intent.FORECAST: [
        _s(r"\b(voy a|vamos a|va a|van a)\b", 3),
        _s(r"\b(pronostic|prediccion|predecir|proyecci|forecast)", 4),
        _s(r"\b(el proximo|la proxima|el que viene|siguiente) (mes|semana|ano|trimestre|dia)", 4),
        _s(r"\bcuando (me |nos |se )?(voy|vamos|va|van|quedo|quedare|acabar|termina|agota)", 4),
        _s(r"\b(cuanto|cuantas|cuantos) .*(vender|vamos a|voy a|van a|se va)", 3),
        _s(r"\bfutur", 2),
        _s(r"\bdemanda\b", 2),
        _s(r"\b(probable|probabilidad de que)\b", 2),
        _s(r"\b(riesgo de|van a dejar de|dejaran de|se van a ir)\b", 3),
        # «Cuándo» pregunta por el futuro salvo que el verbo esté en pasado, y
        # el pasado lo desempata QUERY con sus propias señales. Antes se pedían
        # verbos concretos («cuándo me voy a quedar sin…») y se escapaba la forma
        # más natural de todas: «¿cuándo vuelve a necesitar atención?».
        _s(r"^\s*cuando\b", 3),
        _s(r"\bcuando (vuelve|toca|hay que|se vence|llega|se acaba|tengo que)", 3),
    ],
    Intent.QUERY: [
        _s(r"^\s*(cuanto|cuantos|cuantas)\b(?!.*\b(voy|vamos|va|van|proximo|proxima|futur))", 3),
        _s(r"\b(tengo|tenemos|hay|existe|existen)\b", 2),
        _s(r"\b(el mes pasado|la semana pasada|el ano pasado|ayer|hoy)\b", 3),
        _s(r"\b(lista|listado|muestrame|dame|ensename|ver)\b", 2),
        _s(r"\b(vencid|pendient|abiert|cerrad)", 1),
        _s(r"\b(actual|actualmente|ahora mismo)\b", 2),
        # Verbo en pasado: es lo que distingue «¿cuándo se cerró el ticket?»
        # —un dato registrado— de «¿cuándo vuelve el equipo?», que es un
        # pronóstico. Sin esta línea, la señal de «cuando» arrastraría las dos.
        _s(r"\b(se cerro|se creo|se emitio|fue|fueron|estuvo|ocurrio|paso|se pago|se vendio)\b", 4),
    ],
    Intent.DIAGNOSIS: [
        _s(r"\bpor que\b", 5),
        _s(r"\ba que se debe\b", 5),
        _s(r"\b(causa|motivo|razon) (de|del|por)", 3),
        _s(r"\b(bajaron|subieron|cayeron|aumentaron|disminuy|crecio|cayo)\b", 2),
        _s(r"\bque explica\b", 4),
    ],
    Intent.ANOMALY: [
        # «anormal» y «anomalía» comparten la idea y no el prefijo: `anomal` no
        # casa con «anormal», y esa sola letra dejaba la intención sin detectar en
        # la forma más común de decirlo en español.
        _s(r"\b(anomal|anormal|atipic|raro|rara|extrano|extrana|inusual|sospechos)", 5),
        _s(r"\b(fuera de rango|desviacion|se disparo|se dispararon)\b", 4),
        _s(r"\b(fuera de lo normal|se sale de|no cuadra|no cuadran)\b", 4),
        _s(r"\b(deteccion|detectar) de\b", 2),
        _s(r"\b(error|errores) de captura\b", 3),
    ],
    Intent.RECOMMENDATION: [
        _s(r"\b(deberia|deberiamos|conviene|me conviene|recomiend|sugier)", 5),
        _s(r"\b(cuanto|que|a quien|cuales) .*(pedir|comprar|ordenar|contactar|promover)", 3),
        _s(r"\b(que hago con|que hacemos con)\b", 3),
        _s(r"\bpunto de reorden\b", 3),
    ],
    Intent.OPTIMIZATION: [
        _s(r"\b(optimo|optima|optimiz|maximiz|minimiz)", 5),
        _s(r"\b(el mejor|la mejor) (precio|descuento|reparto|combinacion|ruta)", 4),
        _s(r"\b(maximiza|minimiza|maximice|minimice)\b", 4),
        _s(r"\bcomo (deberia |debo )?(distribuir|repartir|asignar)\b", 3),
    ],
    Intent.SIMULATION: [
        _s(r"\bque pasa si\b", 6),
        _s(r"\bque pasaria si\b", 6),
        _s(r"\bsi (aumento|subo|bajo|reduzco|cambio|quito|pongo)\b", 4),
        _s(r"\b(escenario|simulacion|simular)\b", 4),
        _s(r"\bimpacto de\b", 3),
    ],
    Intent.ACTION: [
        _s(r"^\s*(genera|crea|manda|envia|actualiza|registra|aplica|cancela)\b", 6),
        _s(r"\b(genera|crea) (una |un )?(orden|pedido|requisicion|promocion|alerta)", 5),
        _s(r"\b(enviale|mandale|notifica)\b", 4),
    ],
}


DOMINIOS: list[tuple[re.Pattern[str], Domain]] = [
    (re.compile(r"\b(inventario|stock|existencia|almacen|refaccion|refacciones|pieza)"), Domain.INVENTORY),
    (re.compile(r"\b(compra|compras|proveedor|proveedores|orden de compra|requisicion)"), Domain.PURCHASING),
    (re.compile(r"\b(venta|ventas|negocio|negocios|embudo|pipeline|oportunidad|cotiza)"), Domain.SALES),
    (re.compile(r"\b(cliente|clientes|cuenta|organizacion)"), Domain.CUSTOMERS),
    (re.compile(r"\b(proveedor|proveedores)"), Domain.SUPPLIERS),
    (re.compile(r"\b(producto|productos|articulo|sku)"), Domain.PRODUCTS),
    (re.compile(r"\b(precio|precios|tarifa|margen)"), Domain.PRICING),
    (re.compile(r"\b(promocion|descuento|oferta)"), Domain.PROMOTIONS),
    (re.compile(r"\b(cobrar|cobranza|factura de venta|cuentas por cobrar)"), Domain.RECEIVABLES),
    (re.compile(r"\b(pagar|pago|pagos|cuentas por pagar|factura de proveedor|vencid)"), Domain.PAYABLES),
    (re.compile(r"\b(flujo|caja|finanza|utilidad|rentabilidad|ingreso|gasto)"), Domain.FINANCE),
    (re.compile(r"\b(demanda|consumo|planeacion)"), Domain.DEMAND),
    (re.compile(r"\b(tecnico|tecnicos|personal|carga de trabajo|agenda)"), Domain.WORKFORCE),
    (re.compile(r"\b(servicio|servicios|ticket|tickets|mantenimiento|equipo|equipos|calibra)"), Domain.SERVICE),
    (re.compile(r"\b(entrega|envio|logistica|ruta)"), Domain.LOGISTICS),
]


HORIZONTES: list[tuple[re.Pattern[str], Horizon]] = [
    (re.compile(r"\b(el mes pasado|la semana pasada|el ano pasado|ayer|historic|hasta ahora)"), Horizon.PAST),
    (re.compile(r"\b(ahora|actual|actualmente|hoy|en este momento)"), Horizon.NOW),
    (re.compile(r"\b(hoy|manana|esta semana|proxima semana|proximos dias|\d+ dias)"), Horizon.SHORT),
    (re.compile(r"\b(proximo mes|mes que viene|proximos meses|trimestre)"), Horizon.MEDIUM),
    (re.compile(r"\b(ano que viene|proximo ano|largo plazo|\d+ anos)"), Horizon.LONG),
]


#: Qué tablas del inquilino hace falta leer, por dominio.
#:
#: Nombres REALES del esquema. Sirve para dos cosas: decirle al usuario de
#: dónde va a salir la respuesta antes de calcularla, y para que el día que un
#: dominio no tenga datos se pueda decir cuál falta en vez de devolver vacío.
DATOS: dict[Domain, list[str]] = {
    Domain.INVENTORY: ["spare_parts", "inventory_movements", "ticket_comment_parts"],
    Domain.PURCHASING: ["purchase_orders", "purchase_order_lines", "suppliers", "requisitions"],
    Domain.SALES: ["crm_deals", "crm_deal_products", "crm_stages", "crm_deal_events"],
    Domain.CUSTOMERS: ["crm_organizations", "crm_contacts", "contracts", "tickets"],
    Domain.SUPPLIERS: ["suppliers", "supplier_invoices", "purchase_orders"],
    Domain.PRODUCTS: ["products", "spare_parts"],
    Domain.PRICING: ["crm_deal_products", "spare_parts", "settings"],
    Domain.PROMOTIONS: ["crm_deals", "crm_deal_products"],
    Domain.RECEIVABLES: ["contracts", "crm_deals"],
    Domain.PAYABLES: ["supplier_invoices", "supplier_payments", "purchase_orders"],
    Domain.FINANCE: ["supplier_invoices", "contracts", "tickets", "ticket_comments"],
    Domain.DEMAND: ["ticket_comment_parts", "tickets", "spare_parts"],
    Domain.WORKFORCE: ["tickets", "ticket_comments"],
    Domain.SERVICE: ["tickets", "ticket_comments", "equipment", "contracts"],
    Domain.LOGISTICS: ["purchase_orders"],
    Domain.GENERAL: ["tickets", "crm_deals", "supplier_invoices"],
}


#: Módulo de la pantalla → dominio que sugiere.
#:
#: La pista más barata que existe: quien pregunta desde Compras casi siempre
#: pregunta de compras, y eso resuelve ambigüedades sin molestar al usuario.
MODULO_DOMINIO: dict[str, Domain] = {
    "servicio": Domain.SERVICE,
    "tickets": Domain.SERVICE,
    "equipos": Domain.SERVICE,
    "ventas": Domain.SALES,
    "embudo": Domain.SALES,
    "clientes": Domain.CUSTOMERS,
    "contratos": Domain.CUSTOMERS,
    "compras": Domain.PURCHASING,
    "pedidos": Domain.PURCHASING,
    "requisiciones": Domain.PURCHASING,
    "refacciones": Domain.INVENTORY,
    "inventario": Domain.INVENTORY,
    "pagos": Domain.PAYABLES,
    "rentabilidad": Domain.FINANCE,
}


METODO: dict[Intent, tuple[str, str | None]] = {
    Intent.QUERY: ("Consulta SQL sobre el esquema de la empresa", None),
    Intent.DIAGNOSIS: ("Analítica descriptiva y descomposición por segmento", None),
    Intent.FORECAST: ("Serie de tiempo o regresión con corte temporal", "AutoML"),
    Intent.ANOMALY: ("Detección estadística sobre la distribución histórica", "IQR / Isolation Forest"),
    Intent.RECOMMENDATION: ("Pronóstico más regla de negocio", "AutoML + política"),
    Intent.OPTIMIZATION: ("Optimización con restricciones", "Programación lineal / entera mixta"),
    Intent.SIMULATION: ("Análisis de escenarios", "Monte Carlo sobre el modelo ajustado"),
    Intent.ACTION: ("Escritura en el ERP con autorización", None),
}


def puntuar(texto: str) -> dict[Intent, int]:
    """Cuánta evidencia hay de cada intención."""
    return {
        intent: sum(peso for patron, peso in senales if patron.search(texto))
        for intent, senales in SENALES.items()
    }


def classify(question: str, module: str | None = None) -> Classification:
    """Clasifica una pregunta del negocio. Ver la cabecera del módulo."""
    texto = normalizar(question)
    puntos = puntuar(texto)
    ordenadas = sorted(puntos.items(), key=lambda kv: kv[1], reverse=True)
    mejor, mejor_puntos = ordenadas[0]
    segundo_puntos = ordenadas[1][1] if len(ordenadas) > 1 else 0

    why: list[str] = []
    for intent, senales in SENALES.items():
        for patron, _ in senales:
            m = patron.search(texto)
            if m:
                why.append(f"«{m.group(0).strip()}» → {intent.value}")

    # ── Sin evidencia: no se adivina ─────────────────────────────────────
    #
    # Devolver QUERY por defecto sería lo cómodo y lo peor: contestaría con un
    # SELECT preguntas que pedían un pronóstico, y el usuario vería un número
    # correcto que no responde lo que preguntó.
    if mejor_puntos == 0:
        return Classification(
            primary_intent=Intent.QUERY,
            business_domain=_dominios(texto, module),
            time_horizon=Horizon.NOW,
            required_data=[],
            analytical_method="sin determinar",
            level=Level.QUERY,
            requires_ml=False,
            requires_erp_action=False,
            confidence=0.0,
            clarification_required=True,
            clarification_question=(
                "No reconozco qué quieres saber. ¿Buscas un dato que ya está "
                "registrado, entender por qué pasó algo, o estimar qué va a pasar?"
            ),
            why=["ninguna señal reconocida"],
        )

    # ── Secundarias ──────────────────────────────────────────────────────
    #
    # Una pregunta suele tener más de una intención, y las que arrastra
    # cambian el trabajo: «cuánto debería pedir» es recomendación, pero sin el
    # pronóstico debajo no hay nada que recomendar.
    secundarias = [i for i, p in ordenadas[1:] if p >= max(2, mejor_puntos * 0.4)]
    secundarias.extend(_implicitas(mejor))
    secundarias = [i for i in dict.fromkeys(secundarias) if i != mejor]

    todas = [mejor, *secundarias]
    nivel = floor_for(todas)
    dominios = _dominios(texto, module)
    metodo, modelo = METODO[mejor]

    # La confianza sale del MARGEN, no del puntaje absoluto. Una pregunta que
    # dispara ocho señales de dos intenciones distintas no es más confiable
    # que una que dispara dos de una sola: es más ambigua.
    margen = (mejor_puntos - segundo_puntos) / max(mejor_puntos, 1)
    confianza = round(min(0.95, 0.45 + 0.5 * margen), 2)

    soportado = is_supported(nivel)

    return Classification(
        primary_intent=mejor,
        secondary_intents=secundarias,
        business_domain=dominios,
        entities=_entidades(texto),
        time_horizon=_horizonte(texto, mejor),
        required_data=sorted({t for d in dominios for t in DATOS.get(d, [])}),
        analytical_method=metodo,
        recommended_model=modelo,
        level=nivel,
        requires_ml=nivel in (Level.ML, Level.OPTIMIZATION, Level.SIMULATION),
        requires_erp_action=mejor is Intent.ACTION or Intent.ACTION in secundarias,
        confidence=confianza,
        clarification_required=confianza < 0.55,
        clarification_question=(
            _desambiguar(mejor, ordenadas[1][0]) if confianza < 0.55 else None
        ),
        supported=soportado,
        unsupported_reason=(
            None
            if soportado
            else (
                f"Se entendió la pregunta —{mejor.value} en el escalón "
                f"{nivel.value}— pero esta capa todavía no ejecuta ese escalón. "
                "Ver `IMPLEMENTED` en intents.py."
            )
        ),
        why=why,
    )


def _implicitas(mejor: Intent) -> list[Intent]:
    """Las intenciones que otra ARRASTRA por su propia naturaleza.

    No se detectan en el texto porque no están escritas: quien pregunta cuánto
    debería pedir no menciona el pronóstico, pero sin pronóstico la
    recomendación es una corazonada.
    """
    return {
        Intent.RECOMMENDATION: [Intent.FORECAST],
        Intent.OPTIMIZATION: [Intent.FORECAST],
        Intent.SIMULATION: [Intent.FORECAST],
        Intent.ACTION: [Intent.RECOMMENDATION],
        Intent.DIAGNOSIS: [Intent.QUERY],
        Intent.ANOMALY: [Intent.QUERY],
    }.get(mejor, [])


def _dominios(texto: str, module: str | None) -> list[Domain]:
    encontrados = [d for patron, d in DOMINIOS if patron.search(texto)]
    if module:
        sugerido = MODULO_DOMINIO.get(normalizar(module))
        if sugerido and sugerido not in encontrados:
            # Delante: el módulo desde el que se pregunta manda sobre una
            # palabra suelta del texto.
            encontrados.insert(0, sugerido)
    return list(dict.fromkeys(encontrados)) or [Domain.GENERAL]


ENTIDADES = [
    (re.compile(r"\brefaccion|\bpieza|\bparte\b"), "refacción"),
    (re.compile(r"\bequipo"), "equipo"),
    (re.compile(r"\bticket|\bservicio"), "ticket"),
    (re.compile(r"\bcliente"), "cliente"),
    (re.compile(r"\bproveedor"), "proveedor"),
    (re.compile(r"\bnegocio|\boportunidad"), "negocio"),
    (re.compile(r"\bmes\b|\bmensual"), "mes"),
    (re.compile(r"\bcontrato"), "contrato"),
    (re.compile(r"\btecnico"), "técnico"),
]


def _entidades(texto: str) -> list[str]:
    return [e for patron, e in ENTIDADES if patron.search(texto)]


def _horizonte(texto: str, intent: Intent) -> Horizon:
    for patron, h in HORIZONTES:
        if patron.search(texto):
            return h
    # Sin pista explícita, lo decide la intención: una consulta mira el
    # presente y un pronóstico sin plazo dicho se entiende al mes.
    return {
        Intent.QUERY: Horizon.NOW,
        Intent.DIAGNOSIS: Horizon.PAST,
        Intent.ANOMALY: Horizon.NOW,
    }.get(intent, Horizon.MEDIUM)


def _desambiguar(a: Intent, b: Intent) -> str:
    return (
        f"Tu pregunta se puede leer de dos formas: como {a.value} o como "
        f"{b.value}. ¿Cuál de las dos querías?"
    )


def disambiguate(question: str) -> Classification | None:
    """Enganche para un desempate con modelo de lenguaje. SIN IMPLEMENTAR.

    Existe declarado y vacío a propósito. Es dónde entraría un LLM el día que
    las reglas se queden cortas de verdad —y solo ahí: donde ellas mismas se
    declaran vencidas, no en cada pregunta—. Mientras tanto la salida honesta
    es `clarification_required`, que le devuelve la decisión a quien preguntó.
    """
    return None
