import "server-only";
import { sql, type SQL } from "drizzle-orm";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  TYPE_LABELS,
  label as labelOf,
} from "@/lib/tickets";

/**
 * El vocabulario con el que se arman las preguntas.
 *
 * Este archivo es la razón por la que un usuario puede crear un modelo sin
 * poder crear uno tramposo. La libertad se le da donde es inofensiva —qué
 * predecir, con qué rasgos, con cuánta tolerancia— y lo peligroso se queda
 * aquí, escrito una vez por quien conoce el esquema:
 *
 *  · el ANCLA TEMPORAL de cada sujeto, que define qué cuenta como "el pasado"
 *    de un caso. Es el punto exacto donde se cuela la fuga de información, y
 *    por eso no se elige desde la pantalla ni se elige nunca.
 *
 *  · qué rasgos EXISTEN. La lista de abajo contiene solo columnas que ya están
 *    fijadas en el instante del ancla. Un usuario no puede entrenar con el
 *    estado final del ticket porque `status` no está en el catálogo, no porque
 *    haya un aviso pidiéndole que no lo haga.
 *
 * Ese es el criterio para agregar un rasgo nuevo: ¿su valor es el mismo en el
 * momento del ancla que hoy? Si la respuesta es "depende", no entra.
 * `assigned_to_id` es el ejemplo de manual —parece inocente, se asigna minutos
 * después de crear el ticket y se reasigna a mitad del servicio— y por eso está
 * deliberadamente ausente.
 */

/* ------------------------- Sujetos ------------------------- */

export type Subject = {
  id: string;
  label: string;
  /** Cómo se lee una frase con este sujeto: "Sobre un ticket…". */
  article: string;
  /** Tabla base y sus joins. Fijo: el usuario no compone joins. */
  from: SQL;
  /** Filtro base de qué filas son casos válidos. */
  where: SQL;
  /**
   * EL ANCLA. Cuándo se habría podido predecir este caso.
   *
   * Todo el backtest temporal descansa en esta expresión. Si apuntara a una
   * fecha posterior al hecho —`resolved_at`, por ejemplo— el modelo se
   * entrenaría con el futuro y ninguna de las defensas del laboratorio lo
   * notaría: las métricas saldrían excelentes.
   */
  anchor: SQL;
  /** A qué entidad se le pega la predicción. */
  /**
   * A qué entidad se le pega la predicción.
   *
   * `part` entró con el dominio de compras y trajo consigo una lección: su
   * identidad NO es un uuid sino el número de parte. De los 662 consumos
   * registrados, solo 6 coinciden con una fila del catálogo de refacciones —el
   * resto son números que el técnico anotó en el reporte y que el catálogo
   * nunca llegó a tener—. Insistir en un uuid habría dejado fuera al 99 % de la
   * historia por respetar una llave que en este negocio no es la identidad.
   */
  subjectType: "ticket" | "equipment" | "part" | "period";
  /** El id de esa entidad, leído desde la fila del caso. */
  key: SQL;
  /** Cómo encontrar el caso vivo al momento de predecir. */
  servingWhere: (id: string) => SQL;
  /** Desempate cuando el sujeto tiene varias filas (un equipo, N servicios). */
  servingTail: SQL;
  /**
   * ¿El sujeto pasa una sola vez, o vuelve?
   *
   * Un ticket se predice una vez. Un equipo se predice después de cada
   * servicio. Ver `Template.predictOncePerSubject`.
   */
  predictOnce: boolean;
};

/** Joins compartidos: el equipo del ticket y quien lo levantó. */
const TICKET_FROM = sql`
  tickets t
  left join equipment e on e.id = t.equipment_id
  left join users u on u.id = t.created_by_id
`;

const ticket: Subject = {
  id: "ticket",
  label: "Un ticket de servicio",
  article: "Sobre un ticket",
  from: TICKET_FROM,
  where: sql`true`,
  anchor: sql`t.created_at`,
  subjectType: "ticket",
  key: sql`t.id`,
  servingWhere: (id) => sql`t.id = ${id}`,
  servingTail: sql`limit 1`,
  predictOnce: true,
};

/**
 * El servicio de un equipo.
 *
 * Es la misma tabla que `ticket` pero contando otra historia: cada fila es una
 * visita a un equipo concreto, y la predicción se le pega al EQUIPO, no al
 * ticket. Existe como sujeto aparte porque es lo que permite preguntar cosas
 * que se repiten en el tiempo sobre la misma máquina.
 */
const equipmentService: Subject = {
  id: "equipment_service",
  label: "El servicio de un equipo",
  article: "Sobre un equipo",
  from: TICKET_FROM,
  where: sql`t.equipment_id is not null`,
  anchor: sql`t.created_at`,
  subjectType: "equipment",
  key: sql`t.equipment_id`,
  // Al predecir, el caso vivo es el ÚLTIMO servicio del equipo: es la fila
  // desde la que se cuenta hacia adelante.
  servingWhere: (id) => sql`t.equipment_id = ${id}`,
  servingTail: sql`order by t.created_at desc limit 1`,
  predictOnce: false,
};


/**
 * El consumo de una refacción.
 *
 * Cada fila es una vez que se usó esa pieza en un servicio, y la predicción se
 * le pega al NÚMERO DE PARTE. Es el mismo patrón que `equipment_service` —algo
 * que se repite en el tiempo sobre la misma cosa— aplicado a compras.
 *
 * Se lee de `ticket_comment_parts` y no del ledger de inventario por una razón
 * medida: el ledger tiene 22 movimientos y la bitácora 662 consumos en 31
 * meses. La historia de lo que de verdad se gasta está en lo que el técnico
 * anotó al hacer el servicio, no en lo que alguien registró después.
 */
const partConsumption: Subject = {
  id: "part_consumption",
  label: "El consumo de una refacción",
  article: "Sobre una refacción",
  from: sql`
    ticket_comment_parts pp
    join ticket_comments c on c.id = pp.comment_id
    join tickets t on t.id = c.ticket_id
    left join equipment e on e.id = t.equipment_id
    left join users u on u.id = t.created_by_id
  `,
  where: sql`pp.part_number <> ''`,
  // Cuándo se consumió: desde ahí se cuenta hacia el siguiente consumo.
  anchor: sql`c.created_at`,
  subjectType: "part",
  key: sql`pp.part_number`,
  servingWhere: (id) => sql`pp.part_number = ${id}`,
  servingTail: sql`order by c.created_at desc limit 1`,
  predictOnce: false,
};

/* ------------------------- Sujetos que son un PERIODO ------------------------- */

/**
 * Un mes de cuentas por pagar.
 *
 * Es el primer sujeto cuyo caso NO es una cosa, sino un tramo de tiempo, y por
 * eso importa más de lo que parece. Hasta aquí toda la ontología respondía la
 * misma forma de pregunta: «¿cuánto de X para ESTA entidad?» —las horas de un
 * ticket, los días de una refacción—. «¿Cuánto voy a pagar el mes que viene?»
 * no cabe en esa forma: no hay una entidad a la que pegarle el número. La
 * pregunta es un AGREGADO sobre una ventana.
 *
 * La ontología ya sabía expresarlo sin saberlo. `Target.expr` está definido
 * como «expresión escalar correlacionada con la fila del sujeto», y una
 * subconsulta que suma lo facturado en un mes es exactamente eso. Lo único que
 * faltaba era un sujeto cuyas filas fueran meses, que es lo que genera el
 * `generate_series` de abajo. No hubo que tocar el compilador.
 *
 * EL ANCLA ES EL DÍA 1. Parado ahí, todo lo que sabes es pasado. Es la
 * condición que hace legítimo el rasgo «cuánto se pidió el mes pasado» y la que
 * dejaría fuera cualquier rasgo que mire dentro del propio mes.
 *
 * La serie llega hasta el mes SIGUIENTE al de hoy, y no es un descuido: la
 * consulta de servicio comparte el `from` con la de entrenamiento, así que si
 * la serie acabara en el mes pasado no habría fila que representar al mes que
 * se quiere predecir. Quien recorta el histórico es `keep` —que sí es exclusivo
 * del entrenamiento— dejando fuera el mes en curso y el futuro. Un mes a medias
 * enseñaría que los meses son pequeños.
 */
const payablesMonth: Subject = {
  id: "payables_month",
  label: "Un mes de cuentas por pagar",
  article: "Sobre un mes",
  from: sql`
    (
      select gs::date as mes
        from generate_series(
               (select date_trunc('month', min(issued_at))
                  from supplier_invoices where cancelled_at is null),
               date_trunc('month', now()) + interval '1 month',
               interval '1 month'
             ) gs
    ) m
  `,
  where: sql`m.mes is not null`,
  anchor: sql`m.mes::timestamptz`,
  // El tipo lo estrena este sujeto. `ml_predictions.subject_id` es varchar
  // desde que la identidad de una refacción resultó ser su número de parte, y
  // esa decisión paga aquí otra vez: la identidad de un mes es su fecha.
  subjectType: "period",
  key: sql`m.mes::text`,
  servingWhere: (id) => sql`m.mes = ${id}::date`,
  servingTail: sql`limit 1`,
  predictOnce: true,
};

export const SUBJECTS: Subject[] = [
  ticket,
  equipmentService,
  partConsumption,
  payablesMonth,
];


/* ------------------------- Relaciones ------------------------- */

/**
 * Cómo se llega de un sujeto a OTRA entidad del ERP.
 *
 * Es lo que faltaba para que esto fuera una ontología y no un catálogo de
 * columnas. Hasta aquí, un rasgo era una expresión escalar sobre unos joins
 * fijos escritos a mano dentro del sujeto: para preguntar «¿el proveedor de
 * esta refacción predice cada cuánto se consume?» había que reescribir el
 * `from`. Con la relación declarada, el rasgo la atraviesa y el join se escribe
 * UNA vez.
 *
 * Se declara como subconsulta escalar correlacionada y no como join en el
 * `from`, y es deliberado: un join extra multiplica filas cuando la relación no
 * es uno-a-uno —una refacción se compra muchas veces— y eso contaría un mismo
 * caso varias veces sin que nada avisara. La subconsulta no puede hacer eso.
 *
 * Cada relación dice CÓMO se resuelve la ambigüedad cuando hay varias
 * candidatas (`pick`), porque «el proveedor de esta parte» no es una pregunta
 * bien planteada si se le ha comprado a tres.
 */
export type Relation = {
  id: string;
  /** Sujetos desde los que se puede atravesar. */
  subjects: string[];
  label: string;
  /** Qué entidad se alcanza. Documental hoy; el grafo se lee de aquí. */
  to: string;
  /** Cómo se elige cuando hay varias. En prosa, para poder discutirlo. */
  pick: string;
};

export const RELATIONS: Relation[] = [
  {
    id: "part_supplier",
    subjects: ["part_consumption"],
    label: "Proveedor de la refacción",
    to: "supplier",
    pick:
      "El proveedor al que más veces se le ha comprado ese número de parte. " +
      "No el último: una compra de urgencia a un tercero no debería reescribir " +
      "de quién es la pieza.",
  },
];

export const relationById = (id: string) => RELATIONS.find((r) => r.id === id);

/* ------------------------- Objetivos ------------------------- */

export type Target = {
  id: string;
  /** A qué sujeto pertenece. */
  subject: string;
  label: string;
  unit: string;
  /** Tolerancia que se propone; el usuario puede ajustarla. */
  defaultTolerance: number;
  /**
   * Expresión escalar correlacionada con la fila del sujeto.
   *
   * Aquí SÍ se mira el futuro —es lo que se quiere predecir— y por eso está
   * separado de los rasgos: la asimetría entre estas dos listas es toda la
   * defensa contra la fuga.
   */
  expr: SQL;
  /**
   * Qué filas cuentan como caso observado, en términos del alias `target`.
   *
   * No es limpieza cosmética. Un ticket sin horas en la bitácora no es un
   * servicio de cero horas: es uno del que no se registró nada, y meterlo como
   * cero arrastra la mediana hacia abajo.
   */
  keep: SQL;
};

export const TARGETS: Target[] = [
  {
    id: "payables_amount",
    subject: "payables_month",
    label: "Lo que se va a facturar en el mes",
    unit: "MXN",
    // 60 000 sobre meses que van de 85 000 a 665 000: acertar «el mes que viene
    // se factura medio millón, más menos sesenta mil» sirve para decidir si hay
    // que mover una línea de crédito. Más fino que eso no cambiaría ninguna
    // decisión, y prometerlo solo haría fracasar al modelo por su propio listón.
    defaultTolerance: 60000,
    // Se convierte a pesos en la suma y no después: hay facturas en dólares, y
    // sumar montos de dos monedas produce un número que no es dinero.
    expr: sql`(select coalesce(sum(si.total * coalesce(si.fx_rate, 1)), 0)
                 from supplier_invoices si
                where si.cancelled_at is null
                  and date_trunc('month', si.issued_at) = m.mes)`,
    /*
      Dos recortes, y ninguno es cosmético.

      `target > 0`: un mes sin ninguna factura casi nunca es un mes sin compras,
      es un mes sin capturar. Meterlo como cero arrastra la mediana hacia abajo
      —la misma razón por la que un ticket sin horas no es un servicio de cero
      horas—.

      `at < date_trunc('month', now())`: fuera el mes en curso y el que viene.
      Son las dos filas que la serie genera de más para que exista algo que
      predecir, y entrenar con ellas enseñaría que los meses valen la mitad,
      porque el mes en curso está a medias por definición.
    */
    keep: sql`target > 0 and at < date_trunc('month', now())`,
  },
  {
    id: "days_to_next_use",
    subject: "part_consumption",
    label: "Días hasta el próximo consumo",
    unit: "días",
    defaultTolerance: 15,
    expr: sql`(select extract(epoch from (min(c2.created_at) - c.created_at)) / 86400
                 from ticket_comment_parts p2
                 join ticket_comments c2 on c2.id = p2.comment_id
                where p2.part_number = pp.part_number
                  and c2.created_at > c.created_at)`,
    // Hasta dos años. Por encima, «el próximo consumo» suele ser una pieza que
    // se dejó de usar y volvió con otro equipo: no es la misma pregunta. Se
    // excluye del ENTRENAMIENTO; en producción la medición sí lo registra,
    // porque ahí lo que se mide es lo que pasó.
    keep: sql`target between 1 and 730`,
  },
  {
    id: "service_hours",
    subject: "ticket",
    label: "Horas totales del servicio",
    unit: "h",
    defaultTolerance: 2,
    expr: sql`(select sum(c.hours) from ticket_comments c
                where c.ticket_id = t.id and c.hours is not null)`,
    keep: sql`target > 0`,
  },
  {
    id: "parts_cost",
    subject: "ticket",
    label: "Costo de refacciones",
    unit: "MXN",
    defaultTolerance: 500,
    expr: sql`(select sum(cp.quantity * cp.unit_cost_mxn)
                 from ticket_comment_parts cp
                 join ticket_comments c on c.id = cp.comment_id
                where c.ticket_id = t.id)`,
    keep: sql`target > 0`,
  },
  {
    id: "response_hours",
    subject: "ticket",
    label: "Horas hasta la primera respuesta",
    unit: "h",
    defaultTolerance: 2,
    expr: sql`extract(epoch from (t.first_responded_at - t.created_at)) / 3600`,
    keep: sql`target >= 0`,
  },
  {
    id: "resolution_days",
    subject: "ticket",
    label: "Días hasta resolverse",
    unit: "días",
    defaultTolerance: 3,
    expr: sql`extract(epoch from (t.resolved_at - t.created_at)) / 86400`,
    keep: sql`target >= 0`,
  },
  {
    id: "days_to_next",
    subject: "equipment_service",
    label: "Días hasta el próximo servicio",
    unit: "días",
    defaultTolerance: 15,
    expr: sql`(select extract(epoch from (min(n.created_at) - t.created_at)) / 86400
                 from tickets n
                where n.equipment_id = t.equipment_id
                  and n.created_at > t.created_at)`,
    // El tope de 1000 días no es arbitrario: por encima, el "próximo servicio"
    // suele ser un equipo que volvió tras años fuera de contrato, y no es la
    // misma pregunta. Se excluye del ENTRENAMIENTO; la medición en producción
    // sí lo registra, porque ahí lo que se mide es la realidad.
    keep: sql`target between 1 and 1000`,
  },
];

/* ------------------------- Rasgos ------------------------- */

export type Feature = {
  id: string;
  /** Sujetos en los que está disponible. */
  subjects: string[];
  label: string;
  expr: SQL;
  /** Por qué es seguro: qué lo fija en el instante del ancla. */
  safeBecause: string;
  /**
   * Cómo se lee un VALOR de este rasgo, no su nombre.
   *
   * Los rasgos respaldados por un enum guardan `maintenance` o `medium`, que
   * es lo correcto en la base y lo ilegible en una pantalla. Sin esto, la
   * gráfica del modelo le enseña al administrador «maintenance · WATERS ·
   * medium» y le pide que deduzca el resto. Los rasgos de texto libre —la
   * marca, el cliente— no llevan mapa: ya vienen escritos por una persona.
   */
  valueLabel?: (raw: string, locale: string) => string;
};

export const FEATURES: Feature[] = [
  /* --- Rasgos de un MES. Todos fijados el día 1, que es el ancla. --- */
  {
    id: "month_of_year",
    subjects: ["payables_month"],
    label: "Mes del año",
    expr: sql`to_char(m.mes, 'MM')`,
    safeBecause:
      "Es el propio mes que se está prediciendo: se sabe con años de antelación.",
    valueLabel: (raw, locale) =>
      new Date(Date.UTC(2000, Number(raw) - 1, 1)).toLocaleDateString(locale, {
        month: "long",
        timeZone: "UTC",
      }),
  },
  {
    id: "prev_month_level",
    subjects: ["payables_month"],
    label: "Cómo venía el mes anterior",
    /*
      Comparado contra la MEDIANA DE LOS MESES ANTERIORES, no contra un umbral
      en pesos. Un corte fijo —«más de 300 000 es alto»— es cierto para esta
      empresa este año y falso para la siguiente que use el sistema, o para
      ésta misma después de una devaluación. La referencia móvil se calibra
      sola en cada inquilino y no envejece.

      La mediana mira solo meses ESTRICTAMENTE anteriores a `m.mes`. Si mirara
      todos, cada caso del histórico se estaría comparando contra un promedio
      que incluye su propio futuro, y el backtest saldría bien por la razón
      equivocada.
    */
    expr: sql`(
      with prev as (
        select coalesce(sum(si.total * coalesce(si.fx_rate, 1)), 0) as monto
          from supplier_invoices si
         where si.cancelled_at is null
           and date_trunc('month', si.issued_at) = m.mes - interval '1 month'
      ), base as (
        select percentile_cont(0.5) within group (order by t.monto) as med
          from (
            select sum(si.total * coalesce(si.fx_rate, 1)) as monto
              from supplier_invoices si
             where si.cancelled_at is null
               and date_trunc('month', si.issued_at) < m.mes
             group by date_trunc('month', si.issued_at)
          ) t
      )
      select case
        when (select med from base) is null or (select med from base) = 0 then 'sin-referencia'
        when (select monto from prev) = 0 then 'sin-dato'
        when (select monto from prev) >= 1.25 * (select med from base) then 'alto'
        when (select monto from prev) <= 0.75 * (select med from base) then 'bajo'
        else 'normal' end
    )`,
    safeBecause:
      "El mes anterior ya cerró cuando empieza éste: su total no vuelve a cambiar.",
    valueLabel: (raw) =>
      ({
        alto: "venía alto",
        bajo: "venía bajo",
        normal: "venía normal",
        "sin-dato": "sin facturas el mes previo",
        "sin-referencia": "sin historial para comparar",
      })[raw] ?? raw,
  },
  {
    id: "open_orders_level",
    subjects: ["payables_month"],
    label: "Órdenes de compra abiertas al empezar el mes",
    /*
      El rasgo con más señal de los tres, y el que justifica todo el sujeto: lo
      que se va a facturar el mes que viene sale, en buena parte, de lo que ya
      se pidió y todavía no ha llegado. Es la diferencia entre adivinar y mirar.

      `po.created_at < m.mes` y el cierre posterior al día 1 son la condición de
      no-fuga: cuenta lo que estaba abierto EN ESE INSTANTE, no lo que hoy
      sabemos que estaba abierto.
    */
    expr: sql`(
      with abiertas as (
        select count(*) as n
          from purchase_orders po
         where po.created_at < m.mes
           and (po.closed_at is null or po.closed_at >= m.mes)
      )
      select case
        when (select n from abiertas) = 0 then 'ninguna'
        when (select n from abiertas) <= 2 then 'pocas'
        else 'varias' end
    )`,
    safeBecause:
      "Se cuenta lo que ya estaba abierto el día 1, no lo que se abrió después.",
    valueLabel: (raw) =>
      ({ ninguna: "ninguna abierta", pocas: "1–2 abiertas", varias: "3 o más abiertas" })[raw] ??
      raw,
  },
  {
    id: "part_family",
    subjects: ["part_consumption"],
    label: "Familia de la refacción",
    // El prefijo del número de parte identifica al fabricante o la línea:
    // WAT (Waters), CTS, y las series numéricas 201/700. Medido, agrupa bien:
    // WAT reúne 28 partes con 152 consumos; 201 concentra 125 en solo 8 partes.
    expr: sql`coalesce(substring(pp.part_number from '^[A-Z]{2,4}'),
                       substring(pp.part_number from '^[0-9]{3}'), '')`,
    safeBecause: "Sale del propio número de parte, que se conoce al usarla.",
  },
  {
    id: "part_supplier",
    subjects: ["part_consumption"],
    label: "Proveedor de la refacción",
    /*
      Atraviesa la relación `part_supplier` (ver RELATIONS).

      Subconsulta y no join: a una refacción se le compra muchas veces, y un
      join en el `from` multiplicaría el consumo por el número de compras —cada
      caso contado varias veces, sin que nada avisara—.

      El criterio de desempate es «a quién se le compra más», no «el último»:
      una compra de urgencia a un tercero no debería reescribir de quién es la
      pieza. Ese criterio está escrito en `RELATIONS`, para poder discutirlo.
    */
    expr: sql`coalesce((
      select s.name
        from purchase_order_lines pl
        join purchase_orders po on po.id = pl.order_id
        join suppliers s on s.id = po.supplier_id
       where pl.part_number = pp.part_number
       group by s.name
       order by count(*) desc, s.name
       limit 1
    ), '')`,
    safeBecause:
      "Es el historial de compra de esa pieza, anterior al consumo que se predice.",
  },
  {
    id: "category",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Categoría",
    expr: sql`t.category::text`,
    safeBecause: "Se elige al levantar el ticket.",
    valueLabel: (v, l) => labelOf(CATEGORY_LABELS, v, l),
  },
  {
    id: "priority",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Prioridad",
    expr: sql`t.priority::text`,
    safeBecause: "Se elige al levantar el ticket.",
    valueLabel: (v, l) => labelOf(PRIORITY_LABELS, v, l),
  },
  {
    id: "type",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Origen (solicitud o levantamiento)",
    expr: sql`t.type::text`,
    safeBecause: "Queda determinado por quién lo creó.",
    valueLabel: (v, l) => labelOf(TYPE_LABELS, v, l),
  },
  {
    id: "brand",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Marca del equipo",
    expr: sql`coalesce(e.brand, '')`,
    safeBecause: "Es un dato del equipo, anterior al ticket.",
  },
  {
    id: "equipment_name",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Tipo de equipo",
    expr: sql`coalesce(e.name, '')`,
    safeBecause: "Es un dato del equipo, anterior al ticket.",
  },
  {
    id: "client",
    subjects: ["ticket", "equipment_service", "part_consumption"],
    label: "Cliente",
    expr: sql`coalesce(u.name, u.email, '')`,
    safeBecause: "Es quien levantó el ticket, conocido desde el primer instante.",
  },
];

/* ------------------------- Búsquedas ------------------------- */

export const subjectById = (id: string) => SUBJECTS.find((s) => s.id === id);
export const targetById = (id: string) => TARGETS.find((t) => t.id === id);
export const featureById = (id: string) => FEATURES.find((f) => f.id === id);

/**
 * El valor de un rasgo, en el idioma del usuario.
 *
 * Devuelve el crudo cuando el rasgo no tiene mapa —marca, cliente— porque ahí
 * el crudo YA es lo legible. Nunca falla ni oculta: un valor desconocido se
 * muestra tal cual en vez de convertirse en un hueco.
 */
export function featureValueLabel(
  featureId: string,
  raw: string,
  locale: string,
): string {
  return featureById(featureId)?.valueLabel?.(raw, locale) ?? raw;
}

/** Cuántos rasgos se pueden combinar. Ver `laddersFor` para el porqué. */
export const MAX_FEATURES = 4;

/* ------------------------- Compilación ------------------------- */

export type Definition = {
  subject: Subject;
  target: Target;
  features: Feature[];
};

/**
 * El histórico, compilado desde los bloques.
 *
 * El objetivo se calcula en la capa interna y se filtra en la externa. No es
 * cosmética: permite que `keep` se escriba una sola vez en términos del alias
 * `target` en vez de repetir la subconsulta entera tres veces en el `where`.
 */
export function compileQuery(d: Definition): SQL {
  const cols = d.features.map((f) => sql`${f.expr} as ${sql.raw(f.id)}`);

  return sql`
    select * from (
      select ${d.subject.anchor} as at,
             ${sql.join(cols, sql`, `)}${cols.length ? sql`,` : sql``}
             (${d.target.expr})::float8 as target
        from ${d.subject.from}
       where ${d.subject.where}
    ) x
    where target is not null and ${d.target.keep}
  `;
}

/** Los rasgos de un caso VIVO, con exactamente las mismas expresiones. */
export function compileServingQuery(d: Definition, subjectId: string): SQL {
  const cols = d.features.map((f) => sql`${f.expr} as ${sql.raw(f.id)}`);
  if (cols.length === 0) return sql`select 1 where false`;

  return sql`
    select ${sql.join(cols, sql`, `)}
      from ${d.subject.from}
     where ${d.subject.where} and ${d.subject.servingWhere(subjectId)}
     ${d.subject.servingTail}
  `;
}

/**
 * Las escaleras candidatas para un conjunto de rasgos.
 *
 * Una escalera es un orden de agrupación, de lo más específico a lo más
 * general: `[[categoría, marca], [categoría]]` significa "usa la mediana de esa
 * categoría con esa marca si hay casos suficientes; si no, la de la categoría".
 * Cuál orden funciona mejor depende de los datos —en una empresa manda la
 * marca, en otra la categoría— y no hay forma de saberlo sin medir.
 *
 * Se generan todas las permutaciones y sus prefijos. Con el tope de 4 rasgos
 * son 24 candidatas como máximo, que es justamente por qué existe el tope: el
 * costo crece factorialmente, y cada candidata extra es una oportunidad más de
 * que una gane por azar. Ver `chooseLadder`, que es quien paga esa cuenta.
 */
export function laddersFor(featureIds: string[]): string[][][] {
  const perms: string[][] = [];
  const walk = (rest: string[], acc: string[]) => {
    if (rest.length === 0) {
      perms.push(acc);
      return;
    }
    rest.forEach((x, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]));
  };
  walk(featureIds, []);

  // De cada permutación sale una escalera: el conjunto completo, luego el
  // conjunto sin el último, y así hasta el rasgo más general.
  const seen = new Set<string>();
  const out: string[][][] = [];
  for (const p of perms) {
    const ladder: string[][] = [];
    for (let n = p.length; n >= 1; n--) ladder.push(p.slice(0, n));
    const k = JSON.stringify(ladder);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(ladder);
    }
  }
  return out;
}
