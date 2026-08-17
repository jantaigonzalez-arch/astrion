"""Qué se puede preguntar en cada módulo del ERP.

Este archivo es la razón por la que un usuario puede configurar un modelo sin
poder configurar uno tramposo. La libertad se le da donde es inofensiva —qué
módulo, qué quiere responder, con qué señales, con cuánto margen— y lo
peligroso se queda aquí, escrito una vez por quien conoce el esquema:

  · el ANCLA TEMPORAL de cada sujeto, que define qué cuenta como «el pasado»
    de un caso. Es el punto exacto por donde se cuela la fuga de información,
    y por eso no se elige desde la pantalla ni se elige nunca.

  · qué señales EXISTEN. Solo entran columnas que ya están fijadas en el
    instante del ancla. El usuario no puede entrenar con el estado final del
    ticket porque `status` no está en el catálogo, no porque haya un aviso
    pidiéndole que no lo haga.

El criterio para agregar una señal es una sola pregunta: ¿su valor es el mismo
en el momento del ancla que hoy? Si la respuesta es «depende», no entra.
`assigned_to_id` es el ejemplo de manual —parece inocente, se asigna minutos
después de crear el ticket y se reasigna a mitad del servicio— y por eso está
deliberadamente ausente.

── DOS FORMAS DE PREGUNTA, Y NO UNA ───────────────────────────────────────

El laboratorio anterior solo sabía una: «¿cuánto de X para ESTA entidad?».
Servía para las horas de un ticket y los días de una refacción, y no servía
para nada que fuera una serie en el tiempo — lo que dejó «cuánto se va a
facturar el mes que viene» sin poder contestarse durante todo su desarrollo,
porque no había ninguna forma de expresar una tendencia.

Aquí son dos:

  `Sujeto` — un caso por entidad y momento. Regresión y clasificación.
  `Serie`  — un caso por periodo. Series de tiempo, y con ellas la
             extrapolación, que es lo único que de verdad pronostica el futuro.

Que sean dos tipos y no un parámetro es deliberado: exigen datos distintos,
se evalúan distinto —una serie se corta por fecha, un panel por entidad y
fecha— y admiten modelos que no se parecen. Unificarlos habría producido una
abstracción que miente sobre las dos.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Grain = Literal["day", "week", "month"]
Task = Literal["forecast", "regression", "classification", "anomaly"]


# ═══════════════════════════════════════════════════════════════════
#  Señales y objetivos
# ═══════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class Signal:
    """Una columna con la que se puede aprender, y por qué se puede."""

    id: str
    label: str
    sql: str
    safe_because: str
    """Qué la fija en el instante del ancla. Obligatorio: sin esta frase escrita,
    nadie puede revisar si la señal es legítima."""

    kind: Literal["categorical", "numeric"] = "categorical"


@dataclass(frozen=True)
class Target:
    """Lo que se quiere predecir."""

    id: str
    label: str
    unit: str
    sql: str
    """Aquí SÍ se mira el futuro —es lo que se quiere predecir— y por eso está
    separado de las señales: la asimetría entre las dos listas es toda la
    defensa contra la fuga."""

    keep: str
    """Qué filas cuentan como caso observado. Un ticket sin horas no es un
    servicio de cero horas: es uno del que no se registró nada."""

    default_tolerance: float
    tolerance_kind: Literal["absolute", "relative"] = "relative"
    task: Task = "regression"


# ═══════════════════════════════════════════════════════════════════
#  Sujetos: un caso por entidad
# ═══════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class Sujeto:
    id: str
    module: str
    label: str
    frm: str
    where: str
    anchor: str
    """EL ANCLA. Cuándo se habría podido predecir este caso.

    Todo el backtest descansa en esta expresión. Si apuntara a una fecha
    posterior al hecho, el modelo se entrenaría con el futuro y ninguna defensa
    lo notaría: las métricas saldrían excelentes."""

    key: str
    """De qué entidad es el caso. Necesario para agrupar su propia historia."""

    repeats: bool
    """¿La entidad vuelve, o pasa una sola vez?

    Decide si tienen sentido las señales derivadas de su propio pasado. Un
    ticket pasa una vez; un equipo vuelve después de cada servicio."""

    targets: list[Target]
    signals: list[Signal]


# ═══════════════════════════════════════════════════════════════════
#  Series: un caso por periodo
# ═══════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class Serie:
    """Una magnitud del negocio agregada por periodo.

    `sql` devuelve exactamente dos columnas, `at` y `value`, una fila por
    periodo y ORDENADA. Nada más: una serie no tiene señales porque su única
    señal es ella misma y el calendario. Lo que un modelo puede extraer de ahí
    —nivel, tendencia, estacionalidad— lo construye la etapa de rasgos, no el
    catálogo, para que no dependa de que alguien lo escriba bien en SQL.
    """

    id: str
    module: str
    label: str
    question: str
    unit: str
    grain: Grain
    sql: str
    default_tolerance: float
    tolerance_kind: Literal["absolute", "relative"] = "relative"
    entity_sql: str | None = None
    """Cuando la serie es POR ENTIDAD —el consumo de cada refacción, mes a mes—
    esta consulta devuelve `at`, `key`, `value`. Es lo que permite pronosticar
    trescientas piezas con un solo modelo en vez de trescientos modelos."""

    min_periods: int = 24
    """Cuántos periodos hacen falta para intentarlo.

    Veinticuatro meses no es un número redondo: es el mínimo para ver dos veces
    cada mes del año y poder separar estacionalidad de ruido. Con menos, lo que
    parece un pico de diciembre puede ser un diciembre raro."""


# ═══════════════════════════════════════════════════════════════════
#  El catálogo
# ═══════════════════════════════════════════════════════════════════

TICKET_FROM = """
  tickets t
  left join equipment e on e.id = t.equipment_id
  left join users u on u.id = t.created_by_id
"""

# ── Señales compartidas del dominio de servicio ──────────────────────────

S_CATEGORIA = Signal(
    id="category",
    label="Categoría del servicio",
    sql="t.category::text",
    safe_because="Se elige al levantar el ticket y no cambia después.",
)
S_TIPO = Signal(
    id="type",
    label="Tipo de solicitud",
    sql="t.type::text",
    safe_because="Se fija al crear el ticket: solicitud o visita.",
)
S_PRIORIDAD = Signal(
    id="priority",
    label="Prioridad",
    sql="t.priority::text",
    safe_because="La declara quien levanta el ticket, antes de atenderlo.",
)
S_MARCA = Signal(
    id="brand",
    label="Marca del equipo",
    sql="coalesce(e.brand, '')",
    safe_because="Es un dato del equipo, anterior al ticket.",
)
S_EQUIPO = Signal(
    id="equipment_name",
    label="Tipo de equipo",
    sql="coalesce(e.name, '')",
    safe_because="Es un dato del equipo, anterior al ticket.",
)
S_CLIENTE = Signal(
    id="client",
    label="Cliente",
    sql="coalesce(u.name, u.email, '')",
    safe_because="Es quien levantó el ticket, conocido desde el primer instante.",
)
S_MES = Signal(
    id="month_of_year",
    label="Mes del año",
    sql="to_char(t.created_at, 'MM')",
    safe_because="Es el calendario. Se conoce con años de anticipación.",
)
S_ANTIGUEDAD = Signal(
    id="equipment_age",
    label="Antigüedad del equipo",
    sql="""
      case
        when e.created_at is null then ''
        when t.created_at - e.created_at < interval '1 year'  then 'menos-de-1-ano'
        when t.created_at - e.created_at < interval '3 years' then '1-a-3-anos'
        when t.created_at - e.created_at < interval '6 years' then '3-a-6-anos'
        else 'mas-de-6-anos'
      end
    """,
    safe_because=(
        "Se calcula contra el ancla del propio caso, no contra hoy. Medido "
        "desde `now()` sería una fuga: el mismo caso cambiaría de grupo con el "
        "paso del tiempo y el modelo entrenado hace un año dejaría de "
        "reproducirse."
    ),
)
S_BAJO_CONTRATO = Signal(
    id="under_contract",
    label="Bajo contrato",
    sql="""
      case when exists (
        select 1 from contract_equipment ce
          join contracts c on c.id = ce.contract_id
         where ce.equipment_id = t.equipment_id
           and c.start_date <= t.created_at::date
           and (c.end_date is null or c.end_date >= t.created_at::date)
      ) then 'si' else 'no' end
    """,
    safe_because=(
        "Se evalúa la vigencia del contrato EN LA FECHA DEL CASO, no hoy. Un "
        "contrato firmado después no puede influir en un servicio anterior."
    ),
)

SERVICIO_SIGNALS = [
    S_CATEGORIA, S_TIPO, S_PRIORIDAD, S_EQUIPO, S_MARCA,
    S_CLIENTE, S_MES, S_ANTIGUEDAD, S_BAJO_CONTRATO,
]


SUJETOS: list[Sujeto] = [
    Sujeto(
        id="ticket",
        module="servicio",
        label="Un ticket de servicio",
        frm=TICKET_FROM,
        where="true",
        anchor="t.created_at",
        key="t.id::text",
        repeats=False,
        targets=[
            Target(
                id="service_hours",
                label="Horas de un servicio",
                unit="h",
                sql=(
                    "(select sum(c.hours) from ticket_comments c "
                    "  where c.ticket_id = t.id and c.hours is not null)"
                ),
                keep="target > 0 and target < 40",
                default_tolerance=30,
            ),
            Target(
                id="parts_cost",
                label="Costo de refacciones del servicio",
                unit="MXN",
                sql=(
                    "(select sum(p.quantity * coalesce(p.unit_cost_mxn, 0)) "
                    "   from ticket_comment_parts p "
                    "   join ticket_comments c on c.id = p.comment_id "
                    "  where c.ticket_id = t.id)"
                ),
                keep="target > 0",
                default_tolerance=35,
            ),
        ],
        signals=SERVICIO_SIGNALS,
    ),
    Sujeto(
        id="equipment_service",
        module="equipos",
        label="El servicio de un equipo",
        frm=TICKET_FROM,
        where="t.equipment_id is not null",
        anchor="t.created_at",
        key="t.equipment_id::text",
        repeats=True,
        targets=[
            Target(
                id="days_to_next",
                label="Días hasta el próximo servicio",
                unit="días",
                sql=(
                    "(select extract(epoch from (min(n.created_at) - t.created_at))/86400 "
                    "   from tickets n "
                    "  where n.equipment_id = t.equipment_id and n.created_at > t.created_at)"
                ),
                # El tope no es arbitrario: por encima, el «próximo servicio»
                # suele ser un equipo que volvió tras años fuera de contrato, y
                # esa no es la misma pregunta.
                keep="target > 0 and target < 1000",
                default_tolerance=25,
            ),
        ],
        signals=SERVICIO_SIGNALS,
    ),
    Sujeto(
        id="part_consumption",
        module="refacciones",
        label="El consumo de una refacción",
        frm="""
          ticket_comment_parts pp
          join ticket_comments c on c.id = pp.comment_id
          join tickets t on t.id = c.ticket_id
          left join equipment e on e.id = t.equipment_id
          left join users u on u.id = t.created_by_id
        """,
        where="pp.part_number <> ''",
        anchor="c.created_at",
        # La identidad de una refacción es su NÚMERO DE PARTE y no un uuid: en
        # este negocio la mayoría de los consumos son números que el técnico
        # anotó en el reporte, de piezas que el catálogo nunca llegó a tener.
        key="pp.part_number",
        repeats=True,
        targets=[
            Target(
                id="days_to_next_use",
                label="Días hasta el próximo consumo",
                unit="días",
                sql=(
                    "(select extract(epoch from (min(c2.created_at) - c.created_at))/86400 "
                    "   from ticket_comment_parts p2 "
                    "   join ticket_comments c2 on c2.id = p2.comment_id "
                    "  where p2.part_number = pp.part_number and c2.created_at > c.created_at)"
                ),
                keep="target > 0 and target < 1000",
                default_tolerance=25,
            ),
        ],
        signals=[
            Signal(
                id="part_family",
                label="Familia de la refacción",
                sql="split_part(pp.part_number, '-', 1)",
                safe_because="Sale del propio número de parte, que no cambia.",
            ),
            Signal(
                id="part_brand",
                label="Marca de la refacción",
                sql="coalesce((select sp.brand from spare_parts sp where sp.part_number = pp.part_number limit 1), '')",
                safe_because="Es un atributo del catálogo, anterior al consumo.",
            ),
            S_EQUIPO, S_MARCA, S_CATEGORIA, S_MES, S_BAJO_CONTRATO,
        ],
    ),
    Sujeto(
        id="deal",
        module="ventas",
        label="Una oportunidad de venta",
        frm="""
          crm_deals d
          left join crm_organizations o on o.id = d.organization_id
          left join users v on v.id = d.owner_id
        """,
        where="true",
        anchor="d.created_at",
        key="d.id::text",
        repeats=False,
        targets=[
            # La primera pregunta de CLASIFICACIÓN del sistema. El laboratorio
            # anterior no sabía expresarla: solo predecía números, así que «¿se
            # va a cerrar?» tenía que disfrazarse de probabilidad y no había
            # forma de medirla como lo que era.
            Target(
                id="deal_won",
                label="¿Se va a ganar?",
                unit="",
                sql="case when d.status = 'won' then 1 when d.status = 'lost' then 0 else null end",
                keep="target is not null",
                default_tolerance=0,
                tolerance_kind="absolute",
                task="classification",
            ),
            Target(
                id="days_to_close",
                label="Días hasta cerrar",
                unit="días",
                sql="extract(epoch from (d.closed_at - d.created_at))/86400",
                keep="target > 0 and target < 730",
                default_tolerance=30,
            ),
        ],
        signals=[
            Signal(
                id="deal_source",
                label="Origen de la oportunidad",
                sql="coalesce(d.source, '')",
                safe_because="Se registra al crear la oportunidad; es su procedencia.",
            ),
            Signal(
                id="deal_size",
                label="Tamaño de la oportunidad",
                sql="""
                  case
                    when d.value_mxn is null       then ''
                    when d.value_mxn <  30000      then 'chico'
                    when d.value_mxn < 120000      then 'mediano'
                    when d.value_mxn < 500000      then 'grande'
                    else 'muy-grande'
                  end
                """,
                safe_because="Es el valor cotizado al abrir la oportunidad.",
            ),
            Signal(
                id="deal_owner",
                label="Vendedor",
                sql="coalesce(v.name, '')",
                safe_because="Se asigna al crear la oportunidad.",
            ),
            Signal(
                id="deal_industry",
                label="Giro del cliente",
                sql="coalesce(o.industry, '')",
                safe_because="Es un atributo de la organización, anterior al negocio.",
            ),
            Signal(
                id="deal_month",
                label="Mes del año",
                sql="to_char(d.created_at, 'MM')",
                safe_because="Es el calendario.",
            ),
        ],
    ),
]


# ── Series ────────────────────────────────────────────────────────────────
#
# El `date_trunc` y el `generate_series` van aquí y no en el modelo: una serie
# con meses FALTANTES no es una serie con huecos, es una serie mentirosa —un
# mes sin facturas se lee como «no hubo dato» cuando significa «hubo cero»—.
# Rellenarlo en SQL garantiza que ningún modelo tenga que adivinarlo.

def _mensual(tabla_sql: str, fecha: str, valor: str, extra: str = "") -> str:
    return f"""
      with rango as (
        select date_trunc('month', min({fecha}))::date as desde,
               date_trunc('month', max({fecha}))::date as hasta
          from {tabla_sql}
         where 1 = 1 {extra}
      ),
      meses as (
        select gs::date as at
          from rango, generate_series(rango.desde, rango.hasta, interval '1 month') gs
      )
      select m.at,
             coalesce((
               select sum({valor}) from {tabla_sql}
                where date_trunc('month', {fecha})::date = m.at {extra}
             ), 0)::float8 as value
        from meses m
       order by m.at
    """


SERIES: list[Serie] = [
    Serie(
        id="payables_monthly",
        module="pagos",
        label="Lo que facturan los proveedores cada mes",
        question="¿Cuánto nos van a facturar los proveedores el mes que viene?",
        unit="MXN",
        grain="month",
        # El mes EN CURSO queda fuera: está a medias por definición y entrenar
        # con él enseñaría que los meses valen la mitad.
        sql=_mensual(
            "supplier_invoices si",
            "si.issued_at",
            "si.total",
            "and si.cancelled_at is null",
        )
        + " ",
        default_tolerance=12,
    ),
    Serie(
        id="service_demand_monthly",
        module="servicio",
        label="Servicios atendidos cada mes",
        question="¿Cuántos servicios vamos a atender el mes que viene?",
        unit="tickets",
        grain="month",
        sql=_mensual("tickets t", "t.created_at", "1"),
        default_tolerance=20,
    ),
    Serie(
        id="service_hours_monthly",
        module="servicio",
        label="Horas de campo cada mes",
        question="¿Cuántas horas de campo vamos a necesitar el mes que viene?",
        unit="h",
        grain="month",
        sql=_mensual(
            "ticket_comments c",
            "c.created_at",
            "c.hours",
            "and c.hours is not null",
        ),
        default_tolerance=20,
    ),
    Serie(
        id="parts_demand_monthly",
        module="refacciones",
        label="Refacciones consumidas cada mes",
        question="¿Cuántas refacciones vamos a consumir el mes que viene?",
        unit="piezas",
        grain="month",
        sql=_mensual(
            "ticket_comment_parts p join ticket_comments c on c.id = p.comment_id",
            "c.created_at",
            "p.quantity",
        ),
        default_tolerance=25,
        # Por pieza además del total: es lo que convierte «vamos a gastar más»
        # en «vamos a necesitar estas tres piezas», que es lo accionable.
        entity_sql="""
          select date_trunc('month', c.created_at)::date as at,
                 p.part_number as key,
                 sum(p.quantity)::float8 as value
            from ticket_comment_parts p
            join ticket_comments c on c.id = p.comment_id
           where p.part_number <> ''
           group by 1, 2
           order by 2, 1
        """,
    ),
    Serie(
        id="sales_won_monthly",
        module="ventas",
        label="Valor ganado cada mes",
        question="¿Cuánto vamos a cerrar el mes que viene?",
        unit="MXN",
        grain="month",
        sql=_mensual(
            "crm_deals d",
            "d.closed_at",
            "d.value_mxn",
            "and d.status = 'won'",
        ),
        default_tolerance=25,
    ),
    Serie(
        id="deals_created_monthly",
        module="ventas",
        label="Oportunidades abiertas cada mes",
        question="¿Cuántas oportunidades vamos a abrir el mes que viene?",
        unit="negocios",
        grain="month",
        sql=_mensual("crm_deals d", "d.created_at", "1"),
        default_tolerance=25,
    ),
]


# ── Módulos ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Modulo:
    """Un módulo del ERP y lo que se puede preguntar dentro.

    Existe para que la configuración empiece donde el usuario está, no donde
    está el modelo. Nadie entra al ERP pensando «quiero una regresión»: entra a
    Refacciones y se pregunta cuánto va a necesitar el mes que viene. El módulo
    es la puerta y el catálogo lo que hay detrás.
    """

    id: str
    label: str
    series: list[str] = field(default_factory=list)
    sujetos: list[str] = field(default_factory=list)


MODULOS: list[Modulo] = [
    Modulo("servicio", "Servicio y tickets",
           ["service_demand_monthly", "service_hours_monthly"], ["ticket"]),
    Modulo("equipos", "Equipos", [], ["equipment_service"]),
    Modulo("refacciones", "Refacciones e inventario",
           ["parts_demand_monthly"], ["part_consumption"]),
    Modulo("ventas", "Ventas",
           ["sales_won_monthly", "deals_created_monthly"], ["deal"]),
    Modulo("pagos", "Cuentas por pagar", ["payables_monthly"], []),
]


# ── Búsquedas ─────────────────────────────────────────────────────────────

def sujeto_por_id(sid: str) -> Sujeto | None:
    return next((s for s in SUJETOS if s.id == sid), None)


def serie_por_id(sid: str) -> Serie | None:
    return next((s for s in SERIES if s.id == sid), None)


def modulo_por_id(mid: str) -> Modulo | None:
    return next((m for m in MODULOS if m.id == mid), None)


def target_de(sujeto: Sujeto, tid: str) -> Target | None:
    return next((t for t in sujeto.targets if t.id == tid), None)
