import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { Block, ProjectionBlock, TrendBlock } from "@/lib/ml/blocks-types";
import { equipment, tickets, ticketComments } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { etiquetaMesISO } from "@/lib/ml/meses";
import type { DbOrTx } from "@/lib/db";

/**
 * Servicio, dicho por QUIÉN, POR QUÉ y SOBRE QUÉ.
 *
 * El módulo tenía dos análisis —avisos de la cola y horas estimadas— y los dos
 * responden a «¿qué hay que hacer ahora?». Ninguno respondía a «¿quién lo está
 * haciendo?», y esa pregunta no faltaba solo aquí: hasta este archivo, NINGÚN
 * análisis del catálogo agrupaba por persona. Ni un `group by` por técnico, ni
 * por vendedor, ni por comprador, en los siete módulos.
 *
 * No fue un descuido sino una consecuencia: cada análisis nació recortando una
 * pantalla de trabajo, y una pantalla de trabajo enseña TAREAS —una cola, un
 * calendario, un embudo—, nunca personas. Al partirlas en unidades heredamos
 * sus dimensiones y también sus puntos ciegos.
 *
 * ── POR QUÉ HASTA AHORA NO SE PODÍA ────────────────────────────────────────
 *
 * Aunque alguien hubiera escrito estos bloques la semana pasada, habrían salido
 * vacíos: los 633 tickets del histórico estaban SIN TÉCNICO. El importador
 * indexaba a los técnicos por nombre y el volcado traía el correo, así que
 * ninguno casaba y el destino de ese fallo era `?? null`. Se corrigió el
 * 2026-08-24 y con la reimportación 630 de 633 tickets tienen a quién.
 *
 * Es la lección de este archivo entero: una dimensión no existe porque esté
 * declarada en el esquema, existe cuando tiene datos. Por eso cada bloque de
 * aquí abajo comprueba que haya algo que decir y devuelve `[]` cuando no.
 *
 * ── LO QUE DELIBERADAMENTE NO ESTÁ ─────────────────────────────────────────
 *
 * Dos análisis que cualquiera esperaría y que hoy MENTIRÍAN:
 *
 *   · Tiempo de primera respuesta. `first_responded_at` está en 0 de 633
 *     tickets: el histórico no lo trae y el portal solo lo estampa desde que
 *     alguien responde dentro del sistema.
 *   · Tiempo de resolución. En los 508 cerrados, `resolved_at` es IDÉNTICO a
 *     `created_at` — el origen solo tenía una fecha y el importador la usó para
 *     las dos. Un bloque así diría «0 días» para todo, y eso es peor que una
 *     caja vacía: una caja vacía no afirma nada, un cero afirma algo falso.
 *
 * Los dos empezarán a tener sentido con los tickets que nazcan en el portal.
 * Cuando `first_responded_at` deje de ser cero habrá que añadirlos, y este
 * comentario es el recordatorio.
 */

/** Sin técnicos con trabajo, ningún bloque de personas tiene nada que decir. */
const SIN_ASIGNAR = "Sin asignar";

const n = (v: number) => Math.round(v).toLocaleString("es-MX");

/** Plural sin ceremonia: `${n} ticket${s(n)}`. */
const s = (v: number) => (v === 1 ? "" : "s");

/* ------------------------- 1 · Carga por técnico ------------------------- */

/**
 * Cuántos servicios lleva cada quien, y cuántos siguen abiertos.
 *
 * Las barras son el TOTAL histórico y no lo abierto, y la diferencia importa:
 * lo abierto mide la cola de hoy —que cambia cada mañana y ya se ve en la
 * pantalla de trabajo— mientras que el total mide el reparto del trabajo, que
 * es la pregunta que trae a alguien a un tablero. Lo abierto va en la nota.
 *
 * No se ordena por nombre sino por volumen: la primera barra ES la respuesta a
 * «quién lleva más», y ordenar alfabéticamente obligaría a leer las seis para
 * contestar una pregunta de una línea.
 */
export async function ticketsByTech(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: tickets.assignedToId,
      nombre: users.name,
      total: sql<number>`count(*)::int`,
      abiertos: sql<number>`count(*) filter (where ${tickets.status} <> 'closed')::int`,
    })
    .from(tickets)
    .leftJoin(users, eq(tickets.assignedToId, users.id))
    .where(isNotNull(tickets.assignedToId))
    .groupBy(tickets.assignedToId, users.name)
    .orderBy(desc(sql`count(*)`));

  if (filas.length === 0) return [];

  // Los no asignados se cuentan aparte y NO entran como una barra más: «Sin
  // asignar» no es una persona, y ponerlo en el mismo eje invita a compararlo
  // con quien sí trabajó. Va en la nota, que es donde se lee como lo que es —
  // trabajo sin dueño.
  const [{ huerfanos = 0 } = {}] = await db
    .select({ huerfanos: sql<number>`count(*)::int` })
    .from(tickets)
    .where(sql`${tickets.assignedToId} is null`);

  const total = filas.reduce((a, f) => a + f.total, 0);
  const abiertos = filas.reduce((a, f) => a + f.abiertos, 0);
  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "service.by-tech",
    title: "Carga por técnico",
    note: [
      `${n(total)} servicio${s(total)} repartido${s(total)} entre ${filas.length} ` +
        `técnico${s(filas.length)}. Quien más lleva es ${primero.nombre ?? "—"}, ` +
        `con ${n(primero.total)} (${Math.round((primero.total / total) * 100)} % del total).`,
      abiertos > 0 ? `${n(abiertos)} sigue${abiertos === 1 ? "" : "n"} abierto${s(abiertos)}.` : null,
      huerfanos > 0
        ? `${n(huerfanos)} ticket${s(huerfanos)} sin asignar no entra${huerfanos === 1 ? "" : "n"} en el reparto.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    bars: filas.map((f) => ({
      key: f.id ?? SIN_ASIGNAR,
      label: nombreCorto(f.nombre),
      value: f.total,
      // La lista ya filtra por técnico con ese mismo uuid, así que el enlace
      // es exacto y no una búsqueda por nombre. Sin asignar tiene su propio
      // valor —`sin`— porque no hay uuid que pasar.
      href: `/admin/tickets?tecnico=${f.id ?? "sin"}`,
    })),
    total,
    href: "/admin/tickets",
  };
  return [bloque];
}

/**
 * «Rubén Barrios Borja» → «Rubén B.»
 *
 * Las etiquetas del eje comparten el ancho de la caja entre todas las barras:
 * con seis técnicos y nombres completos no cabe ninguno y el eje se vuelve una
 * fila de puntos suspensivos. El nombre de pila distingue a las seis personas
 * del equipo, y la inicial del apellido cubre el día que entren dos Marías.
 */
function nombreCorto(nombre: string | null): string {
  const limpio = (nombre ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return "—";
  const [pila, apellido] = limpio.split(" ");
  return apellido ? `${pila} ${apellido[0]}.` : pila;
}

/* ------------------------- 2 · Horas por técnico ------------------------- */

/**
 * Las horas efectivas registradas en la bitácora, por quien atendió.
 *
 * Es un análisis distinto del anterior y no una segunda serie suya, porque
 * mide otra cosa: el conteo de tickets dice cuántas veces fue alguien, las
 * horas dicen cuánto duró. Se separan porque se contradicen a menudo —treinta
 * y siete visitas cortas pueden pesar menos que once calificaciones— y ahí es
 * donde está la información.
 *
 * Las horas salen de `ticket_comments.hours`, o sea de lo que el técnico anotó
 * al registrar la actividad. Quien no anota no aparece, y la nota lo dice: un
 * ranking de horas que calla cuántas actividades vienen sin capturar hace
 * quedar mal justo a quien menos papeleo hace.
 */
export async function hoursByTech(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: tickets.assignedToId,
      nombre: users.name,
      horas: sql<number>`coalesce(sum(${ticketComments.hours}), 0)::float`,
      actividades: sql<number>`count(${ticketComments.id})::int`,
    })
    .from(ticketComments)
    .innerJoin(tickets, eq(ticketComments.ticketId, tickets.id))
    .leftJoin(users, eq(tickets.assignedToId, users.id))
    .where(and(isNotNull(tickets.assignedToId), isNotNull(ticketComments.hours)))
    .groupBy(tickets.assignedToId, users.name)
    .orderBy(desc(sql`coalesce(sum(${ticketComments.hours}), 0)`));

  const conHoras = filas.filter((f) => f.horas > 0);
  if (conHoras.length === 0) return [];

  const [{ sinCapturar = 0 } = {}] = await db
    .select({ sinCapturar: sql<number>`count(*)::int` })
    .from(ticketComments)
    .where(sql`${ticketComments.hours} is null`);

  const total = conHoras.reduce((a, f) => a + f.horas, 0);
  const primero = conHoras[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "service.hours-by-tech",
    title: "Horas efectivas por técnico",
    note: [
      `${n(total)} horas registradas en la bitácora. ${primero.nombre ?? "—"} acumula ` +
        `${n(primero.horas)}, en ${n(primero.actividades)} actividad${primero.actividades === 1 ? "" : "es"}.`,
      sinCapturar > 0
        ? `${n(sinCapturar)} actividad${sinCapturar === 1 ? "" : "es"} sin horas capturadas ` +
          `no suma${sinCapturar === 1 ? "" : "n"}: el reparto real puede ser otro.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    bars: conHoras.map((f) => ({
      key: f.id ?? SIN_ASIGNAR,
      label: nombreCorto(f.nombre),
      value: Math.round(f.horas),
      href: `/admin/tickets?tecnico=${f.id ?? "sin"}`,
    })),
    total: Math.round(total),
    href: "/admin/tickets",
  };
  return [bloque];
}

/* ------------------------- 3 · En qué se va el servicio ------------------------- */

const CATEGORIA: Record<string, string> = {
  maintenance: "Mantenimiento",
  validation: "Calificación",
  support: "Soporte",
  other: "Otro",
};

/**
 * De qué naturaleza es el trabajo: mantenimiento, calificación, soporte.
 *
 * Responde al «¿qué?» que el catálogo no tenía. Importa para decidir a quién se
 * contrata: una empresa cuyo servicio es 80 % mantenimiento preventivo necesita
 * manos y calendario; una donde pesa la calificación necesita gente que firme
 * protocolos.
 */
export async function ticketsByCategory(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      categoria: tickets.category,
      total: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .groupBy(tickets.category)
    .orderBy(desc(sql`count(*)`));

  if (filas.length === 0) return [];

  const total = filas.reduce((a, f) => a + f.total, 0);
  const primera = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "service.by-category",
    title: "En qué se va el servicio",
    note:
      `${CATEGORIA[primera.categoria] ?? primera.categoria} es ` +
      `${Math.round((primera.total / total) * 100)} % del trabajo ` +
      `(${n(primera.total)} de ${n(total)}). La clasificación es la que traía cada ` +
      "reporte, no una deducción del sistema.",
    bars: filas.map((f) => ({
      key: f.categoria,
      label: CATEGORIA[f.categoria] ?? f.categoria,
      value: f.total,
      // `categoria` de la lista toma exactamente estos valores del enum.
      href: `/admin/tickets?categoria=${encodeURIComponent(f.categoria)}`,
    })),
    total,
    href: "/admin/tickets",
  };
  return [bloque];
}

/* ------------------------- 4 · Volumen mes a mes ------------------------- */

/**
 * Cuántos servicios entran cada mes.
 *
 * El «¿cuándo?» del módulo, y el único de aquí que es una TENDENCIA: las otras
 * cuatro reparten un total entre categorías: esta enseña una historia con
 * forma, y su contenido es justamente esa forma —si el verano cae, si diciembre
 * se dispara—.
 *
 * Doce meses móviles y no el año natural: en enero, un tablero acotado al año
 * en curso enseña una sola barra.
 *
 * ── UN MES SIN SERVICIOS VALE CERO Y SE QUEDA ────────────────────────────
 *
 * Con `group by date_trunc` a secas solo salían los meses CON tickets, así que
 * un mes sin ninguno desaparecía y las barras saltaban. Este bloque se publica
 * como `axis: "time"`, que promete periodos consecutivos y equiespaciados: el
 * hueco no se veía como hueco, se veía como continuidad.
 *
 * Y torcía la nota, que es lo que de verdad se lee: `promedio` dividía entre el
 * número de meses QUE TUVIERON servicios, no entre los transcurridos. Con
 * cuatro meses activos de doce, «al mes de media» salía triplicado.
 *
 * El espinazo arranca en el primer servicio cuando hay menos de doce meses de
 * historia. Rellenar hacia atrás inventaría meses anteriores a que la empresa
 * usara el sistema, y esos ceros afirmarían que no hubo trabajo cuando lo
 * cierto es que no había registro. Los huecos de ADENTRO sí son un hecho.
 */
export async function ticketsVolume(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = (await db.execute(sql`
    with servicios as (
      -- Sin la columna de estado: la consulta traía además un conteo de
      -- cerrados que no leía nadie, ni en esta versión ni en la anterior.
      select date_trunc('month', ${tickets.createdAt}) as mes
        from ${tickets}
       where ${tickets.createdAt} >= date_trunc('month', current_date) - interval '11 months'
    ),
    rango as (
      select greatest(
               date_trunc('month', current_date) - interval '11 months',
               min(mes)
             ) as desde
        from servicios
       -- OJO: greatest() en Postgres IGNORA los nulos, así que sin una sola
       -- fila devolvía la fecha de hace once meses en vez de nulo y la serie
       -- salía con doce meses en cero. El having deja este CTE sin ninguna
       -- fila cuando no hay datos, y entonces el subselect de abajo sí es
       -- nulo y la serie sale vacía — que es lo que quien llama espera para
       -- callarse, en vez de afirmar doce meses de nada.
       having count(*) > 0
    ),
    meses as (
      select to_char(generate_series(
               (select desde from rango),
               date_trunc('month', current_date),
               interval '1 month'), 'YYYY-MM') as mes
       where (select desde from rango) is not null
    )
    select m.mes             as mes,
           count(s.mes)::int as total
      from meses m
      left join servicios s on to_char(s.mes, 'YYYY-MM') = m.mes
     group by m.mes
     order by m.mes`)) as unknown as Array<{
    mes: string;
    total: number;
  }>;

  if (filas.length === 0) return [];

  const total = filas.reduce((a, f) => a + f.total, 0);
  const promedio = total / filas.length;
  const ultimo = filas[filas.length - 1];

  const bloque: TrendBlock = {
    kind: "trend",
    id: "service.volume",
    title: "Servicios por mes",
    note:
      `${n(total)} servicio${s(total)} en los últimos ${filas.length} mes${filas.length === 1 ? "" : "es"}, ` +
      `${n(promedio)} al mes de media. El mes en curso lleva ${n(ultimo.total)} ` +
      "y está incompleto.",
    axis: "time",
    bars: filas.map((f) => ({
      key: f.mes,
      label: etiquetaMesISO(f.mes),
      value: f.total,
    })),
    href: "/admin/tickets",
  };
  return [bloque];
}

/* ------------------------- 5 · Qué laboratorios piden más ------------------------- */

/**
 * De quién viene el servicio.
 *
 * El equivalente en Servicio de «de qué clientes viene el negocio», y se lee
 * junto a aquel: un laboratorio que concentra el servicio y no el margen es un
 * contrato que hay que renegociar.
 *
 * Se enseñan ocho y el resto se suma en la nota. Con veinticuatro barras la
 * gráfica no se lee y la cola larga no aporta: la pregunta es quién pesa.
 */
export async function ticketsByClient(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: tickets.createdById,
      nombre: users.name,
      total: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .leftJoin(users, eq(tickets.createdById, users.id))
    .groupBy(tickets.createdById, users.name)
    .orderBy(desc(sql`count(*)`));

  if (filas.length === 0) return [];

  // El laboratorio de reparto que crea el importador para lo que no pudo
  // atribuir NO es un cliente, y como barra sería la cuarta más alta: 41
  // tickets que el origen trajo sin nombre. Compararlo con laboratorios reales
  // es comparar un cliente con un cajón de sastre. Sale del eje y se dice en la
  // nota, que es donde se lee como lo que es — trabajo sin dueño.
  const esReparto = (nombre: string | null) => (nombre ?? "").toUpperCase().startsWith("SIN ASIGNAR");
  const reales = filas.filter((f) => !esReparto(f.nombre));
  const huerfanos = filas.filter((f) => esReparto(f.nombre)).reduce((a, f) => a + f.total, 0);
  if (reales.length === 0) return [];

  const TOPE = 8;
  const top = reales.slice(0, TOPE);
  const resto = reales.slice(TOPE);
  const total = reales.reduce((a, f) => a + f.total, 0);
  const primero = top[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "service.by-client",
    title: "Laboratorios que más servicio piden",
    note: [
      `${primero.nombre ?? "—"} concentra ${Math.round((primero.total / total) * 100)} % ` +
        `del servicio (${n(primero.total)} de ${n(total)}).`,
      resto.length > 0
        ? `Se enseñan los ${TOPE} primeros; los otros ${n(resto.length)} suman ` +
          `${n(resto.reduce((a, f) => a + f.total, 0))}.`
        : null,
      huerfanos > 0
        ? `${n(huerfanos)} ticket${s(huerfanos)} sin laboratorio identificado queda${huerfanos === 1 ? "" : "n"} fuera.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    bars: top.map((f) => ({
      key: f.id ?? "—",
      label: nombreCliente(f.nombre),
      value: f.total,
    })),
    total,
    href: "/admin/clientes",
  };
  return [bloque];
}

/**
 * Razones sociales recortadas para el eje.
 *
 * «LABORATORIOS DE ESPECIALIDADES INMUNOLOGICAS» no cabe en una barra de
 * ochenta píxeles ni recortado a la mitad. Se queda con las dos primeras
 * palabras útiles, saltando los genéricos que empiezan casi todas —
 * «laboratorios», «grupo», «industrias»— porque son justo lo que NO distingue a
 * un cliente de otro en una lista de laboratorios.
 */
const GENERICOS = new Set([
  "laboratorios",
  "laboratorio",
  "grupo",
  "industrias",
  "productos",
  // Los conectores van en la misma lista y no en un paso aparte: sin ellos,
  // «LABORATORIOS DE ESPECIALIDADES INMUNOLOGICAS» perdía la primera palabra y
  // la etiqueta quedaba en «DE ESPECIALIDADES», que empieza por una preposición
  // y no identifica a nadie.
  "de",
  "del",
  "la",
  "las",
  "los",
  "y",
  "s.a.",
  "sa",
]);

function nombreCliente(nombre: string | null): string {
  const limpio = (nombre ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return "—";
  const palabras = limpio.split(" ").filter((p) => !GENERICOS.has(p.toLowerCase()));
  const utiles = (palabras.length > 0 ? palabras : limpio.split(" ")).slice(0, 2).join(" ");
  return utiles.length > 18 ? `${utiles.slice(0, 17)}…` : utiles;
}

/* ------------------------- 6 · Qué equipos consumen servicio ------------------------- */

/**
 * Los equipos que más veces hubo que atender.
 *
 * Es el «¿sobre qué?» y el más accionable de los seis: un equipo que aparece
 * arriba cada trimestre o necesita reemplazo o necesita otro contrato, y esa
 * conversación no ocurre porque nadie la ve — cada visita, por separado, parece
 * normal.
 *
 * Solo cuenta los tickets que TIENEN equipo. Los 302 que no lo traen no se
 * reparten ni se estiman: la nota dice cuántos quedan fuera para que nadie lea
 * este bloque como el inventario completo.
 */
export async function ticketsByEquipment(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: tickets.equipmentId,
      nombre: equipment.name,
      marca: equipment.brand,
      total: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .innerJoin(equipment, eq(tickets.equipmentId, equipment.id))
    .groupBy(tickets.equipmentId, equipment.name, equipment.brand)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  if (filas.length === 0) return [];

  const [{ sinEquipo = 0 } = {}] = await db
    .select({ sinEquipo: sql<number>`count(*)::int` })
    .from(tickets)
    .where(sql`${tickets.equipmentId} is null`);

  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "service.by-equipment",
    title: "Equipos que más servicio consumen",
    note: [
      `El que más pide es ${primero.nombre ?? "—"}${primero.marca ? ` (${primero.marca})` : ""}, ` +
        `con ${n(primero.total)} servicio${s(primero.total)}.`,
      sinEquipo > 0
        ? `${n(sinEquipo)} ticket${s(sinEquipo)} no tiene equipo asociado y queda fuera de este conteo.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    bars: filas.map((f) => ({
      key: f.id ?? "—",
      label: nombreEquipo(f.nombre, f.marca),
      value: f.total,
    })),
    href: "/admin/equipos",
  };
  return [bloque];
}

/**
 * Etiqueta de un equipo que lo distinga de los demás EN EL EJE.
 *
 * Los equipos importados se llaman «Parque WATERS — contrato CO1267880 (12
 * módulos)», así que recortarlos por palabras da «Parque WATERS» para varios y
 * el eje sale con cinco barras que parecen la misma. Lo que los distingue es el
 * contrato, no la marca: se usa ese número, con la marca delante para que la
 * barra siga diciendo de qué máquina se habla.
 *
 * Sin contrato en el nombre —los equipos dados de alta a mano desde la UI— se
 * recorta el nombre como cualquier otro texto largo.
 */
function nombreEquipo(nombre: string | null, marca: string | null): string {
  const limpio = (nombre ?? "").replace(/\s+/g, " ").trim();
  const contrato = limpio.match(/contrato\s+([\w/-]+)/i)?.[1];
  if (contrato) {
    const m = (marca ?? "").trim();
    // Hay números de contrato de treinta caracteres —«050GYR019N03524-001-00»—
    // que empujan la etiqueta fuera de su barra. La cola es lo que distingue a
    // dos contratos parecidos, así que se recorta por delante.
    const corto = contrato.length > 12 ? `…${contrato.slice(-11)}` : contrato;
    return m ? `${m} ${corto}` : corto;
  }
  return nombreCliente(limpio);
}
