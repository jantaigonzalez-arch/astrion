import "server-only";
import { sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { Block, ProjectionBlock } from "@/lib/ml/blocks-types";
import type { DbOrTx } from "@/lib/db";

/**
 * El negocio CONTRATADO: de quién viene y cuándo entra.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
 *
 * Había 54 contratos con importe y fecha, y NINGÚN análisis los leía. Los que
 * parecían hacerlo miraban otra cosa: `clients.concentration` suma el valor de
 * los negocios GANADOS del CRM —que aquí está vacío— y `clients.by-rep` cuenta
 * contratos por vendedor, no su importe. Así que el dato mejor capturado de la
 * empresa no salía por ningún lado.
 *
 * ── ESTO ES INGRESO, NO UTILIDAD. Y LA DIFERENCIA NO ES UN MATIZ ───────────
 *
 * Lo que hay aquí es lo que el cliente se comprometió a pagar. Lo que costó
 * atenderlo NO se puede calcular hoy: la fórmula de rentabilidad es
 * `refacciones + horas × tarifa` y en esta instalación las tarifas de mano de
 * obra no están capturadas —`settings` no tiene ni una fila— y las 739 líneas
 * de refacciones consumidas no traen ni precio ni costo. Con los dos sumandos
 * en cero, `profit.trend` y sus tres hermanos devuelven vacío, que es lo
 * correcto: un margen de cero parecería un dato.
 *
 * Por eso cada bloque de aquí dice «ingreso contratado» en su título y lo
 * repite en su nota. Llamarle rentabilidad a esto sería la clase de error que
 * se descubre en una junta.
 *
 * ── UN BLOQUE POR MONEDA, Y NO UN TOTAL ────────────────────────────────────
 *
 * 41 de los 54 contratos están en USD y 13 en MXN, y NINGUNO trae tipo de
 * cambio: `fx_rate` está en nulo en los 54 y `settings.usd_rate` tampoco
 * existe. No hay con qué convertir, así que sumarlos sería inventar una cifra.
 *
 * Se parten por moneda, que es exactamente lo que ya hace el calendario de
 * pagos (`pagar.calendario.<moneda>`). Dos bloques que se leen no es peor que
 * uno que miente.
 */

/**
 * Doce meses hacia adelante. Un año es el periodo en que se planea una cartera
 * y en que una renovación todavía se puede trabajar; a dos años la mitad de la
 * cartera ya venció y la gráfica es casi toda ceros.
 */
const HORIZONTE = 12;

const n = (v: number) => Math.round(v).toLocaleString("es-MX");
const s = (v: number) => (v === 1 ? "" : "s");
/** «mes» no pluraliza con una `s`, y «9 mess» delata la plantilla. */
const meses = (v: number) => (v === 1 ? "mes" : "meses");

/** El importe en su propia moneda. Ver la nota de arriba: no se convierten. */
const IMPORTE = sql<number>`coalesce(c.amount_mxn, c.amount_usd, 0)::float`;

/** Solo lo que tiene con qué contar: importe positivo y vigencia declarada. */
const CONTABLE = sql`
  where coalesce(c.amount_mxn, c.amount_usd, 0) > 0
    and c.start_date is not null
    and c.end_date is not null
    and c.end_date >= c.start_date`;

/* ------------------- 1 · De quién viene el ingreso ------------------- */

/**
 * El ingreso contratado por cliente, de mayor a menor.
 *
 * Es la pregunta «¿de quién dependemos?», que en una cartera de 21 clientes es
 * una pregunta de riesgo y no de curiosidad: si el primero pesa el 40 %, su
 * renovación no es una gestión comercial más.
 *
 * Cuenta el importe TOTAL del contrato y no lo que va corrido, y es
 * deliberado: la dependencia se mide por lo comprometido, que es lo que se
 * pierde si no renueva.
 */
export async function contractRevenueByClient(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db.execute<{
    moneda: string;
    id: string;
    nombre: string | null;
    importe: number;
    contratos: number;
  }>(sql`
    select coalesce(c.currency, 'MXN') as moneda,
           c.client_id                 as id,
           u.name                      as nombre,
           sum(${IMPORTE})             as importe,
           count(*)::int               as contratos
      from contracts c
      left join public.users u on u.id = c.client_id
      ${CONTABLE}
     group by 1, 2, 3
     order by 1, 4 desc`);

  const porMoneda = new Map<string, typeof filas>();
  for (const f of filas) {
    const xs = porMoneda.get(f.moneda) ?? ([] as unknown as typeof filas);
    (xs as unknown as Array<typeof f>).push(f);
    porMoneda.set(f.moneda, xs);
  }

  const bloques: Block[] = [];
  for (const [moneda, xs] of porMoneda) {
    const lista = xs as unknown as Array<(typeof filas)[number]>;
    if (lista.length === 0) continue;

    const total = lista.reduce((a, f) => a + f.importe, 0);
    if (total <= 0) continue;

    // Seis y no todos: es un ranking de dependencia, y a partir de la sexta
    // barra las diferencias dejan de decidir nada.
    const top = lista.slice(0, 6);
    const peso = Math.round((top.reduce((a, f) => a + f.importe, 0) / total) * 100);
    const primero = lista[0];

    bloques.push({
      kind: "projection",
      id: `contracts.revenue.${moneda}`,
      title: `Ingreso contratado por cliente · ${moneda}`,
      note:
        `${n(total)} ${moneda} comprometidos en ${lista.length} cliente${s(lista.length)}. ` +
        `El mayor es ${primero.nombre ?? "—"}, con ${n(primero.importe)} ` +
        `(${Math.round((primero.importe / total) * 100)} % del total)` +
        (lista.length > top.length ? `; los ${top.length} de la gráfica concentran el ${peso} %.` : ".") +
        " Es lo que el cliente se comprometió a pagar, NO la utilidad que deja:" +
        " el costo de atenderlo no se puede calcular mientras no haya tarifas" +
        " de mano de obra capturadas.",
      bars: top.map((f) => ({
        key: f.id,
        label: f.nombre ?? "—",
        value: Math.round(f.importe),
        href: `/admin/contratos?cliente=${f.id}`,
      })),
      currency: moneda,
      total: Math.round(total),
      href: "/admin/contratos",
    } satisfies ProjectionBlock);
  }

  return bloques;
}

/* ------------------- 2 · Cuándo entra ese ingreso ------------------- */

/**
 * El ingreso contratado repartido mes a mes, doce meses hacia adelante.
 *
 * ── ES UNA PROYECCIÓN, NO UN PRONÓSTICO, Y EL TIPO LO EXIGE ───────────────
 *
 * Sale de contratos ya firmados con fechas ya pactadas: es aritmética sobre
 * hechos, igual que el calendario de pagos. No lleva banda de incertidumbre
 * porque no hay ninguna que declarar, y el tipo `ProjectionBlock` directamente
 * no admite una — si alguien quisiera ponérsela, el compilador le diría que lo
 * que tiene entre manos es otra cosa.
 *
 * Lo que sí es un supuesto, y va escrito en la nota: el importe se reparte
 * LINEALMENTE sobre la vigencia. Un contrato de 120 000 a doce meses aporta
 * 10 000 cada mes. Si en la realidad se factura por hitos, esta curva tiene la
 * forma correcta pero no las fechas exactas de cobro — para eso está el
 * calendario de pagos, que lee vencimientos de verdad.
 *
 * ── LO QUE ESTA GRÁFICA ENSEÑA Y NINGUNA OTRA ─────────────────────────────
 *
 * La CAÍDA. Cada contrato deja de aportar el mes en que vence, así que el
 * escalón hacia abajo es la renovación que hay que salir a buscar, con meses
 * de anticipación. Un total anual no lo enseña; una lista de vencimientos lo
 * enseña como fechas sueltas, sin cuánto pesan.
 */
export async function contractRevenueSchedule(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db.execute<{
    moneda: string;
    mes: string;
    importe: number;
    activos: number;
  }>(sql`
    with meses as (
      select generate_series(
               date_trunc('month', current_date),
               date_trunc('month', current_date) + interval '11 months',
               interval '1 month')::date as mes
    ),
    reparto as (
      select coalesce(c.currency, 'MXN') as moneda,
             c.id,
             ${IMPORTE} / greatest(
               -- Meses que abarca la vigencia, contando el primero y el último.
               (date_part('year',  age(date_trunc('month', c.end_date),
                                       date_trunc('month', c.start_date))) * 12
              + date_part('month', age(date_trunc('month', c.end_date),
                                       date_trunc('month', c.start_date))) + 1), 1) as por_mes,
             date_trunc('month', c.start_date)::date as ini,
             date_trunc('month', c.end_date)::date   as fin
        from contracts c
        ${CONTABLE}
    )
    select r.moneda,
           to_char(m.mes, 'YYYY-MM')  as mes,
           sum(r.por_mes)             as importe,
           count(*)::int              as activos
      from meses m
      join reparto r on m.mes between r.ini and r.fin
     group by 1, 2
     order by 1, 2`);

  const porMoneda = new Map<string, Array<(typeof filas)[number]>>();
  for (const f of filas) {
    const xs = porMoneda.get(f.moneda) ?? [];
    xs.push(f);
    porMoneda.set(f.moneda, xs);
  }

  const bloques: Block[] = [];
  for (const [moneda, xs] of porMoneda) {
    if (xs.length === 0) continue;

    const total = xs.reduce((a, f) => a + f.importe, 0);
    const primero = xs[0];
    const ultimo = xs[xs.length - 1];
    // La caída del último mes contra el primero: es la lectura de la gráfica.
    const caida =
      primero.importe > 0
        ? Math.round(((primero.importe - ultimo.importe) / primero.importe) * 100)
        : 0;

    bloques.push({
      kind: "projection",
      id: `contracts.schedule.${moneda}`,
      title: `Ingreso contratado por mes · ${moneda}`,
      note:
        `${n(total)} ${moneda} ya firmados entran en los próximos ${xs.length} ${meses(xs.length)}` +
        // Cuando la serie se corta antes del horizonte NO es que falten datos:
        // es que a partir de ahí no hay ningún contrato vigente. Decirlo evita
        // la lectura de «la gráfica está incompleta».
        (xs.length < HORIZONTE
          ? ` —de un horizonte de ${HORIZONTE}: del mes ${xs.length + 1} en adelante no queda ningún contrato vigente—` +
            `. Se pasa de ${primero.activos} contrato${s(primero.activos)} este mes a ${ultimo.activos} en el último.`
          : `. Se pasa de ${primero.activos} contrato${s(primero.activos)} vigente${s(primero.activos)} este mes ` +
            `a ${ultimo.activos} en el último.`) +
        (caida > 0
          ? ` El ingreso mensual cae un ${caida} % en el horizonte: eso son las renovaciones que hay que salir a buscar.`
          : caida < 0
            ? ` El ingreso mensual sube un ${Math.abs(caida)} % en el horizonte.`
            : "") +
        " Cada contrato se reparte linealmente sobre su vigencia; son fechas" +
        " pactadas, no una estimación. Es ingreso, no utilidad.",
      axis: "time",
      bars: xs.map((f) => ({
        key: f.mes,
        label: etiqueta(f.mes),
        value: Math.round(f.importe),
      })),
      currency: moneda,
      total: Math.round(total),
      href: "/admin/contratos",
    } satisfies ProjectionBlock);
  }

  return bloques;
}

/** `2026-09` → `sep 26`. Corta, que el eje reparte su ancho entre doce. */
function etiqueta(ym: string): string {
  const [a, m] = ym.split("-");
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${MES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}
