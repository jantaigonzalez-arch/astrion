/**
 * CARGA EL TIPO DE CAMBIO DE BANXICO (API del SIE) en `public.tipo_de_cambio`.
 *
 *   npm run tipo-de-cambio                    # ENSAYO: consulta y dice qué haría
 *   npm run tipo-de-cambio -- --aplicar       # escribe
 *   npm run tipo-de-cambio -- --desde 2023-01-01 --aplicar   # histórico
 *
 * En producción lo corre el servicio `tipo-de-cambio` del compose, con
 * `--aplicar`, cada seis horas: el FIX se determina al mediodía de cada día
 * hábil y cuatro consultas al día sobran contra las 40 000 que permite el SIE.
 *
 * ── LO QUE NECESITA ────────────────────────────────────────────────────────
 *
 * `BANXICO_TOKEN`: el token gratuito del SIE. En `.env.local` para desarrollo y
 * en `deploy/.env` del servidor. NUNCA en el repositorio, que es público.
 *
 * ── SE CURA SOLO ───────────────────────────────────────────────────────────
 *
 * Sin `--desde`, pide desde diez días antes del último dato cargado (o desde
 * 2023 si la tabla está vacía). Así una semana con el servidor caído se rellena
 * en la siguiente vuelta, y una cifra que Banxico corrija dentro de esos diez
 * días se actualiza. Lo que ya está igual no se toca.
 *
 * ── LO QUE NO RECONOCE, LO DICE ────────────────────────────────────────────
 *
 * El SIE devuelve `N/E` en los días sin dato: se cuentan y se saltan, no se
 * convierten en cero. Una fecha o un número que no se entienden, o un valor
 * fuera de lo razonable (un dólar a 2 pesos o a 90), detienen la carga ENTERA
 * sin escribir nada: un tipo de cambio mal leído se estampa en cada negocio que
 * se guarde ese día, y eso ya no se deshace solo.
 */
import "./_env";
import { sql } from "drizzle-orm";
import { MONEDAS, SERIES, fechaDelSie, hoyEnMexico, sumarDias, type Moneda } from "../src/lib/tipo-de-cambio";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const aplicar = args.includes("--aplicar");

/** Lo razonable, en pesos. Fuera de aquí es un error de lectura, no el mercado. */
const RANGO: Record<Moneda, [number, number]> = { USD: [8, 45], EUR: [8, 50] };

type Fila = { moneda: Moneda; fecha: string; valor: string; serie: string };

async function consultar(token: string, desde: string, hasta: string) {
  const ids = MONEDAS.map((m) => SERIES[m]).join(",");
  const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${ids}/datos/${desde}/${hasta}`;
  let ultimo: unknown;
  // Un reintento: el SIE a veces tarda, y un fallo aislado no debe esperar seis
  // horas a la siguiente vuelta.
  for (const espera of [0, 5000]) {
    await new Promise((r) => setTimeout(r, espera));
    try {
      const r = await fetch(url, {
        headers: { "Bmx-Token": token, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 401 || r.status === 403) {
        throw new Error(`Banxico rechazó el token (HTTP ${r.status}). Revisa BANXICO_TOKEN.`);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as {
        bmx: { series: Array<{ idSerie: string; datos?: Array<{ fecha: string; dato: string }> }> };
      };
    } catch (e) {
      ultimo = e;
      if (e instanceof Error && /token/.test(e.message)) throw e;
    }
  }
  throw new Error(`no se pudo consultar Banxico: ${ultimo instanceof Error ? ultimo.message : ultimo}`);
}

async function main() {
  const token = process.env.BANXICO_TOKEN?.trim();
  if (!token) {
    console.error("✗ Falta BANXICO_TOKEN (en .env.local o en deploy/.env).");
    process.exit(1);
  }

  const { getDb } = await import("../src/lib/db");
  const { tipoDeCambio } = await import("../src/lib/db/platform");
  const db = getDb();

  const hasta = flag("hasta") ?? hoyEnMexico();
  let desde = flag("desde");
  if (!desde) {
    const [u] = (await db.execute(
      sql`select max(fecha)::text as f from tipo_de_cambio`,
    )) as unknown as Array<{ f: string | null }>;
    desde = u?.f ? sumarDias(u.f, -10) : "2023-01-01";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    console.error("✗ --desde y --hasta van como AAAA-MM-DD.");
    process.exit(1);
  }

  const inicio = Date.now();
  const r = await consultar(token, desde, hasta);
  const porSerie = new Map(Object.entries(SERIES).map(([m, s]) => [s, m as Moneda]));

  const filas: Fila[] = [];
  const errores: string[] = [];
  let sinDato = 0;
  for (const serie of r.bmx.series) {
    const moneda = porSerie.get(serie.idSerie);
    if (!moneda) {
      errores.push(`serie inesperada en la respuesta: ${serie.idSerie}`);
      continue;
    }
    for (const d of serie.datos ?? []) {
      const fecha = fechaDelSie(d.fecha);
      if (d.dato === "N/E") {
        sinDato++;
        continue;
      }
      const valor = Number(d.dato.replace(/,/g, ""));
      if (!fecha) errores.push(`${moneda}: fecha no reconocida «${d.fecha}»`);
      else if (!Number.isFinite(valor)) errores.push(`${moneda} ${fecha}: valor no reconocido «${d.dato}»`);
      else if (valor < RANGO[moneda][0] || valor > RANGO[moneda][1]) {
        errores.push(`${moneda} ${fecha}: ${valor} está fuera de lo razonable (${RANGO[moneda].join("–")})`);
      } else filas.push({ moneda, fecha, valor: valor.toFixed(6), serie: serie.idSerie });
    }
  }

  console.log(`▸ Banxico ${desde} → ${hasta}: ${filas.length} cotizaciones, ${sinDato} días sin dato (N/E)`);
  for (const m of MONEDAS) {
    const ult = filas.filter((f) => f.moneda === m).at(-1);
    console.log(`  ${m}: ${filas.filter((f) => f.moneda === m).length}${ult ? ` · la más reciente ${ult.fecha} = ${Number(ult.valor)}` : ""}`);
  }
  if (errores.length) {
    console.error(`\n✗ ${errores.length} dato(s) que no se entienden. No se escribe nada:`);
    for (const e of errores.slice(0, 20)) console.error(`  · ${e}`);
    process.exit(1);
  }

  // Cuáles son nuevos y cuáles cambian: se compara contra lo cargado.
  const antes = new Map(
    (
      (await db.execute(sql`
        select moneda, fecha::text as fecha, valor::text as valor
        from tipo_de_cambio where fecha between ${desde} and ${hasta}
      `)) as unknown as Array<{ moneda: string; fecha: string; valor: string }>
    ).map((f) => [`${f.moneda}|${f.fecha}`, Number(f.valor)]),
  );
  const nuevas = filas.filter((f) => !antes.has(`${f.moneda}|${f.fecha}`));
  const cambian = filas.filter((f) => {
    const v = antes.get(`${f.moneda}|${f.fecha}`);
    return v !== undefined && Math.abs(v - Number(f.valor)) > 1e-9;
  });
  console.log(`  ${nuevas.length} nuevas · ${cambian.length} corregidas por Banxico · ${filas.length - nuevas.length - cambian.length} sin cambio`);
  for (const c of cambian.slice(0, 10)) {
    console.log(`    ${c.moneda} ${c.fecha}: ${antes.get(`${c.moneda}|${c.fecha}`)} → ${Number(c.valor)}`);
  }

  if (!aplicar) {
    console.log("\n· Ensayo: no se escribió nada. Repetir con --aplicar.");
    process.exit(0);
  }

  const escribir = [...nuevas, ...cambian];
  for (let i = 0; i < escribir.length; i += 500) {
    await db
      .insert(tipoDeCambio)
      .values(escribir.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [tipoDeCambio.moneda, tipoDeCambio.fecha],
        set: { valor: sql`excluded.valor`, serie: sql`excluded.serie`, cargadoEn: sql`now()` },
      });
  }
  console.log(`\n✓ ${escribir.length} escritas en ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
