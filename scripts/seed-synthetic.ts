/**
 * Una empresa de servicio con diez años de historia, generada.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/seed-synthetic.ts --slug bajio
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/seed-synthetic.ts --slug bajio --reset
 *
 * ── PARA QUÉ ───────────────────────────────────────────────────────────────
 *
 * Evoelution tiene 602 tickets en 31 meses. Con eso, medio laboratorio no se
 * puede evaluar: el bosque aleatorio nunca se presenta, «lo que se va a
 * facturar el mes que viene» tiene seis casos, y los rasgos derivados resumen
 * el pasado de piezas que solo se han usado siete veces. No se puede poner
 * orden en la capa de ML mirando datos que no alcanzan para distinguir un
 * modelo bueno de uno con suerte.
 *
 * ── LO QUE HACE ESTO ÚTIL NO ES EL VOLUMEN ─────────────────────────────────
 *
 * Es que la estructura plantada está ESCRITA. Todo lo que este archivo mete en
 * los datos aparece abajo, en `VERDAD`, con su tamaño de efecto y su ruido.
 *
 * Sin eso, un conjunto sintético es una trampa cara: se entrena, sale bien, y
 * lo único que se ha comprobado es que el modelo aprendió las suposiciones de
 * quien escribió el generador. Con la verdad escrita, la pregunta cambia y se
 * vuelve contestable: ¿encuentra el laboratorio lo que se plantó, con qué
 * error, y con cuántos casos empieza a encontrarlo? Eso sí se puede auditar.
 *
 * Dos reglas que sostienen esa utilidad:
 *
 *  1 · EL RUIDO MANDA. Los efectos son moderados y la dispersión es alta (CV
 *      de 0,22 a 0,50). Un generador con señal limpia produce modelos que
 *      aciertan el 95 % y una confianza que se rompe el primer día en
 *      producción. Aquí un modelo perfecto seguiría fallando, porque los datos
 *      no contienen la respuesta completa — como en la realidad.
 *
 *  2 · SE GENERA EL PROCESO, NO LAS FILAS. Cada equipo tiene su calendario de
 *      servicios; cada refacción, su ritmo de consumo. Los intervalos no se
 *      escriben: EMERGEN de simular la vida del equipo. Fabricar directamente
 *      la columna «días hasta el próximo servicio» habría sido plantar la
 *      respuesta en vez del fenómeno.
 *
 * Determinista por semilla: dos corridas dan el mismo conjunto, byte a byte.
 * Es el mismo compromiso que el bosque aleatorio y que los parquet congelados.
 */
import "./_env";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

/* ============================================================
   Argumentos
   ============================================================ */

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const SLUG = flag("slug") ?? "bajio";
const SCHEMA = `tenant_${SLUG}`;
const RESET = args.includes("--reset");
const SEED = Number(flag("seed") ?? 20260816);

/** Diez años, cerrados en una fecha fija para que el conjunto no cambie solo. */
const INICIO = new Date("2016-09-01T08:00:00Z");
const FIN = new Date("2026-08-16T08:00:00Z");

/* ============================================================
   Azar reproducible
   ============================================================ */

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);

/** Normal estándar por Box-Muller. */
function normal(): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Lognormal con media y coeficiente de variación pedidos.
 *
 * Lognormal y no normal porque los tiempos no son simétricos: un servicio
 * puede tardar el triple de lo normal, nunca menos de cero. Esa cola derecha es
 * la que hace que la MEDIANA sea la estadística correcta en todo el
 * laboratorio, y un generador gaussiano la habría borrado.
 */
function lognormal(media: number, cv: number): number {
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(media) - s2 / 2 + Math.sqrt(s2) * normal());
}

const entre = (a: number, b: number) => a + rnd() * (b - a);
const entero = (a: number, b: number) => Math.floor(entre(a, b + 1));
const elige = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const quizas = (p: number) => rnd() < p;

function pesado<T extends string>(pesos: Record<T, number>): T {
  const total = Object.values(pesos).reduce((a: number, b) => a + (b as number), 0);
  let x = rnd() * total;
  for (const [k, p] of Object.entries(pesos) as Array<[T, number]>) {
    if ((x -= p) <= 0) return k;
  }
  return Object.keys(pesos)[0] as T;
}

const dias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const diasEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86400000;

/* ============================================================
   LA VERDAD PLANTADA
   ============================================================
   Todo lo que sigue es lo que un modelo PODRÍA descubrir. Nada más está
   metido en los datos: lo demás es ruido.
   ============================================================ */

/**
 * Intervalo natural de mantenimiento, en días, por tipo de equipo.
 *
 * Son los ritmos reales de un laboratorio analítico: un HPLC se atiende cada
 * trimestre y una balanza una o dos veces al año. Es el efecto MÁS FUERTE del
 * conjunto y el que la plantilla «días hasta el próximo servicio» debería
 * encontrar a través del rasgo `category`.
 */
const RITMO_EQUIPO = {
  HPLC: 95,
  "Cromatógrafo de gases": 120,
  Espectrofotómetro: 150,
  "Balanza analítica": 185,
  Centrífuga: 210,
  Autoclave: 165,
  "Titulador automático": 175,
  "Baño de agua": 240,
} as const;
type TipoEquipo = keyof typeof RITMO_EQUIPO;

/**
 * Modificador por marca.
 *
 * Efecto real y de segundo orden: las marcas caras traen contrato de servicio
 * del fabricante y se atienden más seguido; las genéricas se atienden cuando
 * fallan. Un modelo que use `brand` debería ganar algo sobre uno que no, pero
 * poco — y esa diferencia pequeña es a propósito.
 */
const MARCA = {
  Waters: 0.92,
  Agilent: 0.94,
  Shimadzu: 1.0,
  "Thermo Fisher": 1.03,
  PerkinElmer: 1.05,
  Hanna: 1.18,
  Velp: 1.22,
} as const;
type Marca = keyof typeof MARCA;

/** Con contrato se atiende antes y con MUCHA menos dispersión. */
const CONTRATO_FACTOR = 0.85;
const CV_CON_CONTRATO = 0.22;
const CV_SIN_CONTRATO = 0.45;

/** Los equipos envejecen: cada año de antigüedad acorta el intervalo un 1,8 %. */
const DESGASTE_ANUAL = 0.018;

/**
 * Ritmo de consumo por familia de refacción, en días.
 *
 * Lo que debería encontrar «cada cuánto se consume esta refacción» a través de
 * `part_family`. Un sello se cambia cada trimestre y una lámpara cada año largo.
 */
const RITMO_PIEZA = {
  Sellos: 75,
  Empaques: 90,
  Filtros: 110,
  Jeringas: 160,
  Columnas: 220,
  Válvulas: 320,
  Lámparas: 400,
  Electrodos: 260,
} as const;
type FamiliaPieza = keyof typeof RITMO_PIEZA;

const CV_PIEZA = 0.5;

/**
 * Horas de un servicio, por categoría.
 *
 * Lo que debería encontrar «horas de un servicio». La validación es larga y el
 * soporte es corto; el resto está en medio y se confunde, que es justamente por
 * qué ese modelo apenas le gana a la mediana en datos reales.
 */
const HORAS = {
  maintenance: 3.5,
  calibration: 2.2,
  validation: 6.5,
  training: 4.0,
  support: 1.8,
  sales: 1.2,
  other: 2.4,
} as const;
type Categoria = keyof typeof HORAS;

const CV_HORAS = 0.45;
/** Una visita presencial pesa más que una solicitud atendida a distancia. */
const FACTOR_SERVICIO = 1.25;

/**
 * Estacionalidad del gasto con proveedores, por mes.
 *
 * Diciembre dispara (cierre de ejercicio y presupuesto que se pierde si no se
 * ejerce), enero se desploma, agosto baja por vacaciones. Es el patrón de una
 * empresa mexicana y es lo que debería encontrar «lo que se va a facturar el
 * mes que viene» a través de `month_of_year` — la primera plantilla que con
 * estos datos tiene 120 casos en vez de seis.
 */
const ESTACION = [0.75, 0.92, 1.02, 0.98, 1.05, 1.0, 0.95, 0.88, 1.06, 1.08, 1.15, 1.35];

/** Crecimiento del negocio: de 45 a 190 tickets al mes en diez años. */
const TICKETS_MES_INICIO = 45;
const TICKETS_MES_FIN = 190;

/** Gasto mensual con proveedores, en MXN, de un extremo al otro. */
const GASTO_MES_INICIO = 380_000;
const GASTO_MES_FIN = 1_350_000;
const CV_GASTO = 0.18;

/**
 * Los módulos que trae cada tipo de equipo.
 *
 * No es decoración: la bitácora del ERP permite anotar el servicio contra un
 * módulo concreto, y sin módulos esa parte de la pantalla se ve rota.
 */
const MODULOS: Record<TipoEquipo, string[]> = {
  HPLC: ["Bomba binaria", "Automuestreador", "Detector UV-Vis", "Horno de columna"],
  "Cromatógrafo de gases": ["Inyector split/splitless", "Horno", "Detector FID"],
  Espectrofotómetro: ["Lámpara de deuterio", "Monocromador", "Portaceldas"],
  "Balanza analítica": ["Celda de pesaje", "Cortaaires"],
  Centrífuga: ["Rotor", "Motor", "Tapa de seguridad"],
  Autoclave: ["Cámara", "Generador de vapor", "Válvula de purga"],
  "Titulador automático": ["Bureta", "Electrodo", "Agitador"],
  "Baño de agua": ["Resistencia", "Termostato"],
};

/* ============================================================
   LA VERDAD PLANTADA · lado comercial
   ============================================================ */

/**
 * Probabilidad base de ganar un negocio, por ORIGEN.
 *
 * El efecto más fuerte del embudo, y el más real: un referido llega con la
 * confianza puesta y una lista fría no. Es lo que debería encontrar cualquier
 * pregunta futura del tipo «¿este negocio se va a cerrar?».
 */
const GANA_POR_ORIGEN = {
  Referido: 0.62,
  "Cliente existente": 0.55,
  "Feria del sector": 0.34,
  "Sitio web": 0.28,
  "Campaña de correo": 0.19,
  "Llamada en frío": 0.12,
} as const;
type Origen = keyof typeof GANA_POR_ORIGEN;

/**
 * Los negocios GRANDES se cierran menos y tardan más.
 *
 * Efecto de segundo orden, deliberadamente moderado: por cada vez que el valor
 * se multiplica por diez, la probabilidad de ganar baja 12 puntos y el ciclo se
 * alarga un 55 %. Es la clase de patrón que un modelo puede encontrar solo si
 * el valor entra como rasgo agrupado, no como número suelto.
 */
const PENALIZACION_POR_DECADA = 0.12;
const CICLO_POR_DECADA = 0.55;

/** Días de ciclo para un negocio de tamaño típico, y su dispersión. */
const CICLO_BASE = 45;
const CV_CICLO = 0.6;

/**
 * Cada vendedor tiene su propia mano.
 *
 * Multiplica la probabilidad del origen. Se planta a propósito para que exista
 * la pregunta «¿quién cierra mejor?» y para comprobar que el sistema NO la
 * confunde con el mérito de haber recibido mejores orígenes — que es el error
 * clásico al leer un embudo.
 */
const MANO_VENDEDOR = [1.18, 1.05, 1.0, 0.92, 0.82];

/* ============================================================
   Catálogos de nombres
   ============================================================ */

const CLIENTES = [
  "Laboratorio Clínico del Centro", "Analítica Industrial SA", "Farmacéutica Solaris",
  "Instituto de Investigación Química", "Alimentos del Valle", "Cervecería Regional",
  "Aguas y Saneamiento Municipal", "Petroquímica del Golfo", "Universidad Tecnológica",
  "Hospital General Norte", "Metrología Aplicada", "Grupo Lácteo Bajío",
  "Minera Santa Fe", "Tratadora Ambiental", "Control de Calidad Textil",
  "Laboratorio Bromatológico", "Química Fina de México", "Biotecnología Aplicada",
  "Centro de Diagnóstico Molecular", "Aceites y Grasas Vegetales", "Ingenio Azucarero",
  "Fundición del Norte", "Papel y Celulosa", "Cosméticos Naturales",
  "Laboratorio de Suelos", "Agroindustrias del Pacífico", "Refinadora Nacional",
  "Vidrio Templado Industrial", "Envases Flexibles", "Nutrición Animal Premium",
];

const TECNICOS = [
  "Rubén Salazar", "Marisol Ortega", "Javier Peña", "Lucía Domínguez",
  "Arturo Villalobos", "Norma Cervantes", "Ignacio Bautista", "Paola Guerrero",
  "Esteban Ríos", "Verónica Lugo", "Ramiro Escobar", "Claudia Mena",
];

const VENDEDORES = [
  "Adriana Fuentes", "Gerardo Palacios", "Mónica Estrada",
  "Fernando Zepeda", "Cecilia Nájera",
];

/**
 * El giro sale del NOMBRE del cliente, no de un sorteo.
 *
 * Sorteado quedaba «Ingenio Azucarero · Salud» en la pantalla de clientes, y
 * un dato que se contradice a sí mismo enseña a desconfiar de la pantalla
 * entera — aunque el resto sea correcto. Cuesta doce líneas evitarlo.
 */
const GIRO: Array<[RegExp, string]> = [
  [/farmac|química fina|cosmétic/i, "Farmacéutica"],
  [/aliment|cervec|lácteo|azucarero|aceites|nutrición|bromatol/i, "Alimentos y bebidas"],
  [/químic|petroquímic|refinadora|papel|celulosa/i, "Química"],
  [/agua|ambiental|tratadora|saneamiento|suelos/i, "Ambiental"],
  [/fundición|metal|vidrio|textil|envases/i, "Manufactura"],
  [/universidad|instituto|investigación|centro de/i, "Académica"],
  [/hospital|clínic|diagnóstic|molecular/i, "Salud"],
  [/agro|agroindustri|animal/i, "Agroindustria"],
  [/miner/i, "Minería"],
  [/metrolog|analítica|control de calidad|biotecnolog/i, "Servicios analíticos"],
];

function giroDe(nombre: string): string {
  for (const [re, giro] of GIRO) if (re.test(nombre)) return giro;
  return "Industrial";
}

const PROVEEDORES = [
  "Refacciones Analíticas SA", "Chromatek México", "Instrumental Científico",
  "Suministros de Laboratorio Nacional", "Waters de México", "Agilent Technologies México",
  "Distribuidora Shimadzu", "Insumos Cromatográficos", "Filtros y Membranas SA",
  "Óptica y Fuentes de Luz", "Sellos Industriales del Centro", "Válvulas de Precisión",
  "Electrodos y Sensores MX", "Vidriería Científica", "Gases Especiales del Bajío",
];

/* ============================================================
   Generación
   ============================================================ */

type Equipo = {
  id: string;
  ownerId: string;
  tipo: TipoEquipo;
  marca: Marca;
  modelo: string;
  instalado: Date;
  /** Su intervalo PROPIO, alrededor del cual varían sus servicios reales. */
  ritmo: number;
  conContrato: boolean;
};

type Pieza = {
  id: string;
  numero: string;
  descripcion: string;
  familia: FamiliaPieza;
  marca: Marca;
  costo: number;
  ritmo: number;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const sql = postgres(url, { prepare: false, max: 4 });

  const [{ exists }] = await sql<[{ exists: boolean }]>`
    select exists(select 1 from information_schema.schemata where schema_name = ${SCHEMA}) as exists
  `;
  if (!exists) {
    throw new Error(
      `No existe ${SCHEMA}. Créalo antes:\n` +
        `  npx tsx scripts/tenant.ts provision --slug ${SLUG} --name "..."`,
    );
  }

  const [tenant] = await sql<[{ id: string }]>`
    select id from public.tenants where slug = ${SLUG}
  `;
  if (!tenant) throw new Error(`No hay inquilino con slug ${SLUG}.`);

  console.log(`\nSEMBRANDO ${SCHEMA}  ·  semilla ${SEED}`);
  console.log(`  ${INICIO.toISOString().slice(0, 10)} → ${FIN.toISOString().slice(0, 10)}`);

  if (RESET) {
    console.log("\n  vaciando lo anterior…");
    await sql.unsafe(`
      truncate ${SCHEMA}.ticket_comment_parts, ${SCHEMA}.ticket_comments,
               ${SCHEMA}.tickets, ${SCHEMA}.contract_equipment, ${SCHEMA}.contracts,
               ${SCHEMA}.equipment_submodules, ${SCHEMA}.equipment_modules,
               ${SCHEMA}.equipment, ${SCHEMA}.purchase_order_lines,
               ${SCHEMA}.purchase_orders, ${SCHEMA}.supplier_payments,
               ${SCHEMA}.supplier_invoices, ${SCHEMA}.inventory_movements,
               ${SCHEMA}.spare_parts, ${SCHEMA}.suppliers,
               ${SCHEMA}.crm_deal_products, ${SCHEMA}.crm_deal_labels,
               ${SCHEMA}.crm_deal_events, ${SCHEMA}.crm_activities,
               ${SCHEMA}.crm_notes, ${SCHEMA}.crm_deals, ${SCHEMA}.crm_contacts,
               ${SCHEMA}.crm_organizations, ${SCHEMA}.crm_labels,
               ${SCHEMA}.crm_goals, ${SCHEMA}.leads,
               ${SCHEMA}.products, ${SCHEMA}.services, ${SCHEMA}.brands,
               ${SCHEMA}.ml_predictions, ${SCHEMA}.ml_outcomes, ${SCHEMA}.ml_models
      cascade
    `);
    await sql`delete from public.users where email like ${`%@${SLUG}.demo`}`;
  }

  const meses = Math.round(diasEntre(INICIO, FIN) / 30.44);

  /* ---------- Personas ---------- */

  type U = { id: string; name: string; email: string };
  const clientes: U[] = [];
  const tecnicos: U[] = [];

  // Más clientes que nombres del catálogo: se les pone sucursal.
  const CIUDADES = ["León", "Querétaro", "Irapuato", "Celaya", "Salamanca", "Silao"];
  for (let i = 0; i < 88; i++) {
    const base = CLIENTES[i % CLIENTES.length];
    const name = i < CLIENTES.length ? base : `${base} — ${CIUDADES[i % CIUDADES.length]}`;
    clientes.push({
      id: randomUUID(),
      name,
      email: `cliente${i + 1}@${SLUG}.demo`,
    });
  }
  for (let i = 0; i < TECNICOS.length; i++) {
    tecnicos.push({
      id: randomUUID(),
      name: TECNICOS[i],
      email: `tecnico${i + 1}@${SLUG}.demo`,
    });
  }

  const todos = [...clientes, ...tecnicos];
  await sql`
    insert into public.users ${sql(
      todos.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        active: true,
        created_at: INICIO,
      })),
      "id", "name", "email", "active", "created_at",
    )}
  `;
  await sql`
    insert into public.memberships ${sql(
      todos.map((u) => ({
        id: randomUUID(),
        user_id: u.id,
        tenant_id: tenant.id,
        // Los roles reales del sistema: quien atiende es `agent`, quien pide
        // servicio es `client`. Sembrar todo como una sola cosa habría dejado
        // un inquilino donde ninguna pantalla filtra por rol.
        role: tecnicos.includes(u) ? ("agent" as const) : ("client" as const),
        active: true,
        accepted_at: INICIO,
        created_at: INICIO,
      })),
      "id", "user_id", "tenant_id", "role", "active", "accepted_at", "created_at",
    )}
  `;
  console.log(`  personas            ${todos.length} (${clientes.length} clientes, ${tecnicos.length} técnicos)`);

  /* ---------- Equipos ---------- */

  const tipos = Object.keys(RITMO_EQUIPO) as TipoEquipo[];
  const marcas = Object.keys(MARCA) as Marca[];
  const equipos: Equipo[] = [];

  // El parque crece: la mitad estaba desde el principio, el resto va entrando.
  const TOTAL_EQUIPOS = 540;
  for (let i = 0; i < TOTAL_EQUIPOS; i++) {
    const tipo = pesado({
      HPLC: 22, "Cromatógrafo de gases": 15, Espectrofotómetro: 16,
      "Balanza analítica": 14, Centrífuga: 10, Autoclave: 8,
      "Titulador automático": 8, "Baño de agua": 7,
    } as Record<TipoEquipo, number>);
    const marca = elige(marcas);

    // Entradas concentradas al principio y luego constantes.
    const frac = i < TOTAL_EQUIPOS * 0.4 ? rnd() * 0.15 : rnd();
    const instalado = dias(INICIO, frac * diasEntre(INICIO, FIN));

    // Los equipos caros llevan contrato más a menudo.
    const caro = MARCA[marca] <= 1.0;
    const conContrato = quizas(caro ? 0.55 : 0.2);

    equipos.push({
      id: randomUUID(),
      ownerId: elige(clientes).id,
      tipo,
      marca,
      modelo: `${marca.slice(0, 3).toUpperCase()}-${entero(1000, 9999)}`,
      instalado,
      conContrato,
      // El ritmo PROPIO del equipo: el de su tipo, movido por marca, contrato y
      // una idiosincrasia suya que no está en ninguna columna. Esa parte es la
      // que solo puede capturar un rasgo derivado del propio historial.
      ritmo:
        RITMO_EQUIPO[tipo] *
        MARCA[marca] *
        (conContrato ? CONTRATO_FACTOR : 1) *
        lognormal(1, 0.18),
    });
  }

  await sql`
    insert into ${sql.unsafe(SCHEMA)}.equipment ${sql(
      equipos.map((e) => ({
        id: e.id,
        owner_id: e.ownerId,
        brand: e.marca,
        name: e.tipo,
        model: e.modelo,
        created_at: e.instalado,
      })),
      "id", "owner_id", "brand", "name", "model", "created_at",
    )}
  `;
  console.log(`  equipos             ${equipos.length} (${equipos.filter((e) => e.conContrato).length} con contrato)`);

  /* ---------- Refacciones ---------- */

  const familias = Object.keys(RITMO_PIEZA) as FamiliaPieza[];
  const piezas: Pieza[] = [];
  for (let i = 0; i < 320; i++) {
    const familia = elige(familias);
    const marca = elige(marcas);
    piezas.push({
      id: randomUUID(),
      numero: `${familia.slice(0, 3).toUpperCase()}-${String(10000 + i)}`,
      descripcion: `${familia.slice(0, -1)} ${marca} ${entero(1, 99)}`,
      familia,
      marca,
      costo: Math.round(lognormal(2800, 0.9)),
      ritmo: RITMO_PIEZA[familia] * lognormal(1, 0.25),
    });
  }
  await sql`
    insert into ${sql.unsafe(SCHEMA)}.spare_parts ${sql(
      piezas.map((p) => ({
        id: p.id,
        part_number: p.numero,
        description: p.descripcion,
        brand: p.marca,
        cost_mxn: p.costo,
        price_mxn: Math.round(p.costo * entre(1.35, 1.9)),
        stock: entero(0, 25),
        active: true,
        created_at: INICIO,
        updated_at: INICIO,
      })),
      "id", "part_number", "description", "brand", "cost_mxn", "price_mxn",
      "stock", "active", "created_at", "updated_at",
    )}
  `;
  console.log(`  refacciones         ${piezas.length}`);

  /* ---------- Proveedores ---------- */

  const proveedores = PROVEEDORES.map((name, i) => ({
    id: randomUUID(),
    name,
    terms: elige([15, 30, 30, 45, 60]),
    moneda: i % 5 === 0 ? "USD" : "MXN",
  }));
  await sql`
    insert into ${sql.unsafe(SCHEMA)}.suppliers ${sql(
      proveedores.map((p) => ({
        id: p.id,
        name: p.name,
        rfc: `${p.name.slice(0, 3).toUpperCase()}${entero(100000, 999999)}XX${entero(10, 99)}`,
        payment_terms_days: p.terms,
        currency: p.moneda,
        active: true,
        created_at: INICIO,
        updated_at: INICIO,
      })),
      "id", "name", "rfc", "payment_terms_days", "currency", "active",
      "created_at", "updated_at",
    )}
  `;
  console.log(`  proveedores         ${proveedores.length}`);

  /* ---------- Contratos ---------- */

  const contratos: Array<{ id: string; equipos: string[] }> = [];
  const conContrato = equipos.filter((e) => e.conContrato);
  // Se agrupan por cliente: un contrato cubre varios equipos del mismo.
  const porCliente = new Map<string, Equipo[]>();
  for (const e of conContrato) {
    const xs = porCliente.get(e.ownerId) ?? [];
    xs.push(e);
    porCliente.set(e.ownerId, xs);
  }
  const filasContrato: Record<string, unknown>[] = [];
  const filasContratoEquipo: Record<string, unknown>[] = [];
  let nContrato = 0;
  for (const [clienteId, xs] of porCliente) {
    // Contratos anuales renovados: uno por año desde el equipo más antiguo.
    let desde = new Date(Math.min(...xs.map((e) => e.instalado.getTime())));
    while (desde < FIN) {
      const hasta = dias(desde, 365);
      const id = randomUUID();
      nContrato++;
      filasContrato.push({
        id,
        number: `CTR-${String(nContrato).padStart(5, "0")}`,
        client_id: clienteId,
        sales_rep_id: elige(tecnicos).id,
        amount_mxn: Math.round(xs.length * lognormal(48000, 0.4)),
        currency: "MXN",
        start_date: desde.toISOString().slice(0, 10),
        end_date: hasta.toISOString().slice(0, 10),
        created_at: desde,
      });
      for (const e of xs) filasContratoEquipo.push({ contract_id: id, equipment_id: e.id });
      contratos.push({ id, equipos: xs.map((e) => e.id) });
      desde = hasta;
    }
  }
  await enLotes(sql, `${SCHEMA}.contracts`, filasContrato, [
    "id", "number", "client_id", "sales_rep_id", "amount_mxn", "currency",
    "start_date", "end_date", "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.contract_equipment`, filasContratoEquipo, [
    "contract_id", "equipment_id",
  ]);
  console.log(`  contratos           ${filasContrato.length}`);

  /* ---------- Tickets: se simula la vida de cada equipo ---------- */

  type TicketGen = {
    id: string;
    equipo: Equipo | null;
    fecha: Date;
    categoria: Categoria;
    tipo: "request" | "service";
    prioridad: "low" | "medium" | "high" | "urgent";
    horas: number;
    tecnico: U;
    cliente: string;
  };

  const tickets: TicketGen[] = [];

  // 1 · El calendario de mantenimiento de cada equipo. De aquí SALEN los
  //     intervalos que la plantilla intenta predecir; no se escriben a mano.
  for (const e of equipos) {
    let t = dias(e.instalado, entre(20, e.ritmo));
    while (t < FIN) {
      const edadAnios = diasEntre(e.instalado, t) / 365;
      const desgaste = Math.max(0.7, 1 - DESGASTE_ANUAL * edadAnios);
      const cv = e.conContrato ? CV_CON_CONTRATO : CV_SIN_CONTRATO;

      const categoria: Categoria = quizas(0.72)
        ? "maintenance"
        : quizas(0.6)
          ? "calibration"
          : "validation";

      tickets.push({
        id: randomUUID(),
        equipo: e,
        fecha: new Date(t),
        categoria,
        tipo: "service",
        prioridad: pesado({ low: 20, medium: 55, high: 20, urgent: 5 }),
        horas: horasDe(categoria, "service", e.tipo),
        tecnico: elige(tecnicos),
        cliente: e.ownerId,
      });

      t = dias(t, Math.max(12, lognormal(e.ritmo * desgaste, cv)));
    }
  }

  // 2 · Incidencias y solicitudes, con la tasa creciente del negocio.
  const totalIncidencias = Math.round(meses * 34);
  for (let i = 0; i < totalIncidencias; i++) {
    // Repartidas con la curva de crecimiento, no uniformemente.
    const u = rnd();
    const frac = Math.sqrt(u) * 0.35 + u * 0.65;
    const fecha = dias(INICIO, frac * diasEntre(INICIO, FIN));
    if (fecha >= FIN) continue;

    const disponibles = equipos.filter((e) => e.instalado <= fecha);
    const e = disponibles.length && quizas(0.7) ? elige(disponibles) : null;
    const categoria = pesado({
      support: 40, training: 12, maintenance: 18, calibration: 10,
      validation: 8, sales: 6, other: 6,
    } as Record<Categoria, number>);
    const tipo = quizas(0.45) ? "service" : "request";

    tickets.push({
      id: randomUUID(),
      equipo: e,
      fecha,
      categoria,
      tipo,
      prioridad: pesado({ low: 25, medium: 50, high: 18, urgent: 7 }),
      horas: horasDe(categoria, tipo, e?.tipo ?? null),
      tecnico: elige(tecnicos),
      cliente: e ? e.ownerId : elige(clientes).id,
    });
  }

  tickets.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  console.log(`  tickets             ${tickets.length}`);

  const filasTicket = tickets.map((t, i) => {
    const respuesta = dias(t.fecha, lognormal(0.35, 0.9));
    const cierre = dias(respuesta, Math.max(0.2, lognormal(t.horas / 6, 0.7)));
    return {
      id: t.id,
      reference: `IAB-${String(i + 1).padStart(6, "0")}`,
      subject: asuntoDe(t.categoria, t.equipo?.tipo ?? null),
      description: descripcionDe(t.categoria, t.equipo?.tipo ?? null),
      status: "closed",
      priority: t.prioridad,
      category: t.categoria,
      type: t.tipo,
      created_by_id: t.cliente,
      assigned_to_id: t.tecnico.id,
      equipment_id: t.equipo?.id ?? null,
      first_responded_at: respuesta,
      resolved_at: cierre,
      created_at: t.fecha,
      updated_at: cierre,
    };
  });
  await enLotes(sql, `${SCHEMA}.tickets`, filasTicket, [
    "id", "reference", "subject", "description", "status", "priority",
    "category", "type", "created_by_id", "assigned_to_id", "equipment_id",
    "first_responded_at", "resolved_at", "created_at", "updated_at",
  ]);

  /* ---------- Comentarios: donde viven las horas ---------- */

  const comentarios: Array<{ id: string; ticket: TicketGen; fecha: Date; horas: number | null }> = [];
  for (const t of tickets) {
    // El comentario de cierre lleva las horas. Es el que el ERP usa.
    const cierre = dias(t.fecha, Math.max(0.1, lognormal(t.horas / 6, 0.7)));
    comentarios.push({ id: randomUUID(), ticket: t, fecha: cierre, horas: t.horas });
    // Alguno lleva además una nota de seguimiento sin horas.
    if (quizas(0.35)) {
      comentarios.push({
        id: randomUUID(),
        ticket: t,
        fecha: dias(t.fecha, entre(0.05, 0.5)),
        horas: null,
      });
    }
  }
  await enLotes(
    sql,
    `${SCHEMA}.ticket_comments`,
    comentarios.map((c) => ({
      id: c.id,
      ticket_id: c.ticket.id,
      author_id: c.ticket.tecnico.id,
      body: c.horas
        ? `Servicio concluido. ${notaTecnica(c.ticket.categoria)}`
        : "Se acordó ventana de atención con el cliente.",
      internal: false,
      equipment_id: c.ticket.equipo?.id ?? null,
      hours: c.horas === null ? null : c.horas.toFixed(2),
      created_at: c.fecha,
    })),
    ["id", "ticket_id", "author_id", "body", "internal", "equipment_id", "hours", "created_at"],
  );
  console.log(`  comentarios         ${comentarios.length}`);

  /* ---------- Consumo de refacciones ---------- */

  /*
    Cada pieza tiene su propio calendario de consumo, y cada consumo se cuelga
    del servicio real más cercano. Así los dos ritmos —el del equipo y el de la
    pieza— quedan en los datos a la vez, que es lo que ocurre de verdad: se
    cambia el sello cuando toca el sello, aprovechando que el técnico ya está
    ahí por el mantenimiento.
  */
  const cierres = comentarios.filter((c) => c.horas !== null);
  const porFecha = [...cierres].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  const consumos: Record<string, unknown>[] = [];
  for (const p of piezas) {
    // Las piezas entran al catálogo escalonadas: no todo existía en 2016.
    const alta = dias(INICIO, rnd() * diasEntre(INICIO, FIN) * 0.5);
    let t = dias(alta, rnd() * p.ritmo);
    while (t < FIN) {
      // El servicio más cercano dentro de una ventana de 45 días.
      const cand = busquedaCercana(porFecha, t, 45);
      if (cand) {
        consumos.push({
          id: randomUUID(),
          comment_id: cand.id,
          part_id: p.id,
          part_number: p.numero,
          description: p.descripcion,
          quantity: quizas(0.8) ? 1 : entero(2, 4),
          unit_cost_mxn: p.costo,
          unit_price_mxn: Math.round(p.costo * entre(1.35, 1.9)),
        });
      }
      t = dias(t, Math.max(7, lognormal(p.ritmo, CV_PIEZA)));
    }
  }
  await enLotes(sql, `${SCHEMA}.ticket_comment_parts`, consumos, [
    "id", "comment_id", "part_id", "part_number", "description", "quantity",
    "unit_cost_mxn", "unit_price_mxn",
  ]);
  console.log(`  consumos de pieza   ${consumos.length}`);

  /* ---------- Compras y facturas de proveedor ---------- */

  const ordenes: Record<string, unknown>[] = [];
  const lineas: Record<string, unknown>[] = [];
  const facturas: Record<string, unknown>[] = [];
  let nOrden = 0;
  let nFactura = 0;

  for (let m = 0; m < meses; m++) {
    const mes = new Date(INICIO.getFullYear(), INICIO.getMonth() + m, 1);
    if (mes >= FIN) break;
    const frac = m / meses;

    // El gasto del mes: tendencia × estacionalidad × ruido.
    const base = GASTO_MES_INICIO + (GASTO_MES_FIN - GASTO_MES_INICIO) * frac;
    const objetivo = base * ESTACION[mes.getMonth()] * lognormal(1, CV_GASTO);

    // Se reparte en órdenes hasta cubrirlo.
    let acumulado = 0;
    while (acumulado < objetivo) {
      const prov = elige(proveedores);
      const id = randomUUID();
      nOrden++;
      const fechaOrden = dias(mes, entre(0, 27));
      const nLineas = entero(1, 5);
      let totalOrden = 0;

      for (let l = 0; l < nLineas; l++) {
        const p = elige(piezas);
        const q = entero(1, 8);
        totalOrden += p.costo * q;
        lineas.push({
          id: randomUUID(),
          order_id: id,
          part_id: p.id,
          part_number: p.numero,
          description: p.descripcion,
          quantity: q,
          received_quantity: q,
          unit_cost_mxn: p.costo,
          created_at: fechaOrden,
        });
      }

      ordenes.push({
        id,
        reference: `OC-${String(nOrden).padStart(6, "0")}`,
        supplier_id: prov.id,
        status: "received",
        currency: "MXN",
        expected_at: dias(fechaOrden, entero(5, 30)).toISOString().slice(0, 10),
        sent_at: fechaOrden,
        closed_at: dias(fechaOrden, entero(6, 40)),
        created_at: fechaOrden,
        updated_at: fechaOrden,
      });

      // La factura llega poco después de la orden y vence según los términos.
      const emision = dias(fechaOrden, entero(2, 20));
      if (emision < FIN) {
        nFactura++;
        const subtotal = Math.round(totalOrden);
        const iva = Math.round(subtotal * 0.16);
        facturas.push({
          id: randomUUID(),
          reference: `FP-${String(nFactura).padStart(6, "0")}`,
          supplier_id: prov.id,
          supplier_folio: `${entero(1000, 99999)}`,
          currency: "MXN",
          subtotal,
          tax_total: iva,
          total: subtotal + iva,
          issued_at: emision.toISOString().slice(0, 10),
          due_at: dias(emision, prov.terms).toISOString().slice(0, 10),
          status: dias(emision, prov.terms) < FIN ? "paid" : "pending",
          created_at: emision,
          updated_at: emision,
        });
      }
      acumulado += totalOrden;
    }
  }

  await enLotes(sql, `${SCHEMA}.purchase_orders`, ordenes, [
    "id", "reference", "supplier_id", "status", "currency", "expected_at",
    "sent_at", "closed_at", "created_at", "updated_at",
  ]);
  await enLotes(sql, `${SCHEMA}.purchase_order_lines`, lineas, [
    "id", "order_id", "part_id", "part_number", "description", "quantity",
    "received_quantity", "unit_cost_mxn", "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.supplier_invoices`, facturas, [
    "id", "reference", "supplier_id", "supplier_folio", "currency", "subtotal",
    "tax_total", "total", "issued_at", "due_at", "status", "created_at", "updated_at",
  ]);
  console.log(`  órdenes de compra   ${ordenes.length} (${lineas.length} líneas)`);
  console.log(`  facturas proveedor  ${facturas.length}`);

  /* ---------- Pagos a proveedor ---------- */

  const pagos = facturas
    .filter((f) => f.status === "paid")
    .map((f) => {
      // Se paga cerca del vencimiento: unos antes, la mayoría después. Es lo
      // que hace que «saldo vencido» signifique algo en las pantallas.
      const vence = new Date(String(f.due_at));
      const pagado = dias(vence, Math.round(lognormal(6, 1.1)) - 3);
      const cuando = pagado < FIN ? pagado : vence;
      return {
        id: randomUUID(),
        invoice_id: f.id,
        amount: f.total,
        // Se liquida de una vez: el saldo posterior es cero. Los pagos
        // parciales existen en el ERP pero no aportan nada al laboratorio.
        balance_after: 0,
        method: elige(["transfer", "transfer", "check", "cash"]),
        reference: `PAG-${entero(100000, 999999)}`,
        paid_at: cuando.toISOString().slice(0, 10),
        occurred_at: cuando,
      };
    });
  await enLotes(sql, `${SCHEMA}.supplier_payments`, pagos, [
    "id", "invoice_id", "amount", "balance_after", "method", "reference",
    "paid_at", "occurred_at",
  ]);
  console.log(`  pagos a proveedor   ${pagos.length}`);

  /* ---------- Módulos de los equipos ---------- */

  const modulos: Record<string, unknown>[] = [];
  const submodulos: Record<string, unknown>[] = [];
  for (const e of equipos) {
    for (const nombre of MODULOS[e.tipo]) {
      const id = randomUUID();
      modulos.push({
        id,
        equipment_id: e.id,
        brand: e.marca,
        name: nombre,
        serial_number: `${nombre.slice(0, 2).toUpperCase()}${entero(10000, 99999)}`,
        created_at: e.instalado,
      });
      if (quizas(0.5)) {
        submodulos.push({
          id: randomUUID(),
          module_id: id,
          name: `${nombre} · componente ${entero(1, 4)}`,
          serial_number: `SC${entero(10000, 99999)}`,
          created_at: e.instalado,
        });
      }
    }
  }
  await enLotes(sql, `${SCHEMA}.equipment_modules`, modulos, [
    "id", "equipment_id", "brand", "name", "serial_number", "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.equipment_submodules`, submodulos, [
    "id", "module_id", "name", "serial_number", "created_at",
  ]);
  console.log(`  módulos de equipo   ${modulos.length} (${submodulos.length} submódulos)`);

  await sembrarComercial(sql, {
    clientes,
    tecnicos,
    piezas,
    meses,
  });

  console.log(`\n  ${meses} meses de historia. Listo.\n`);
  await sql.end();
}

/* ============================================================
   Auxiliares
   ============================================================ */

function horasDe(cat: Categoria, tipo: "request" | "service", equipo: TipoEquipo | null): number {
  // Los equipos complejos alargan la visita; los sencillos la acortan.
  const complejidad =
    equipo === "HPLC" || equipo === "Cromatógrafo de gases"
      ? 1.3
      : equipo === "Balanza analítica" || equipo === "Baño de agua"
        ? 0.8
        : 1.0;
  const base = HORAS[cat] * complejidad * (tipo === "service" ? FACTOR_SERVICIO : 1);
  return Math.min(24, Math.max(0.25, lognormal(base, CV_HORAS)));
}

/** El cierre de servicio más cercano a una fecha, dentro de una ventana. */
function busquedaCercana<T extends { fecha: Date }>(
  ordenados: T[],
  objetivo: Date,
  ventanaDias: number,
): T | null {
  let lo = 0;
  let hi = ordenados.length - 1;
  const t = objetivo.getTime();
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ordenados[mid].fecha.getTime() < t) lo = mid + 1;
    else hi = mid;
  }
  let mejor: T | null = null;
  for (let i = Math.max(0, lo - 2); i < Math.min(ordenados.length, lo + 3); i++) {
    const d = Math.abs(diasEntre(ordenados[i].fecha, objetivo));
    if (d <= ventanaDias && (!mejor || d < Math.abs(diasEntre(mejor.fecha, objetivo)))) {
      mejor = ordenados[i];
    }
  }
  return mejor;
}

const ASUNTOS: Record<Categoria, string[]> = {
  maintenance: ["Mantenimiento preventivo", "Servicio programado", "Revisión periódica"],
  calibration: ["Calibración anual", "Ajuste de calibración", "Verificación metrológica"],
  validation: ["Calificación IQ/OQ", "Validación de desempeño", "Requalificación"],
  training: ["Capacitación a usuarios", "Entrenamiento de operación"],
  support: ["Falla en operación", "Lectura inestable", "No enciende", "Ruido en línea base"],
  sales: ["Cotización de refacciones", "Consulta comercial"],
  other: ["Traslado de equipo", "Actualización de software"],
};

function asuntoDe(cat: Categoria, equipo: TipoEquipo | null): string {
  const base = elige(ASUNTOS[cat]);
  return equipo ? `${base} — ${equipo}` : base;
}

function descripcionDe(cat: Categoria, equipo: TipoEquipo | null): string {
  return `${elige(ASUNTOS[cat])}${equipo ? ` sobre ${equipo}` : ""}. Reportado por el cliente.`;
}

function notaTecnica(cat: Categoria): string {
  return elige([
    "Se verificó desempeño dentro de especificación.",
    "Se sustituyeron consumibles y se dejó en operación.",
    "Se ajustaron parámetros y se corrió prueba de aceptación.",
    "Equipo entregado conforme al procedimiento.",
  ]);
}

/** Inserta en lotes: un INSERT de 20.000 filas revienta el límite de parámetros. */
async function enLotes(
  sql: postgres.Sql,
  tabla: string,
  filas: Record<string, unknown>[],
  cols: string[],
  tam = 1000,
) {
  for (let i = 0; i < filas.length; i += tam) {
    const lote = filas.slice(i, i + tam);
    await sql`insert into ${sql.unsafe(tabla)} ${sql(lote as never, ...(cols as never[]))}`;
  }
}


/* ============================================================
   La capa comercial
   ============================================================ */

/**
 * Clientes, contactos, el embudo de ventas y el catálogo público.
 *
 * Va en su propia función porque es otro negocio: arriba se simula la vida de
 * un equipo, aquí la de una oportunidad. Comparten las personas y las
 * refacciones, y nada más.
 *
 * Los negocios se generan como PROCESO igual que los servicios: cada uno nace
 * con un origen y un tamaño, y de ahí salen su probabilidad de cierre y su
 * duración. El resultado —ganado o perdido, y cuándo— se sortea con esa
 * probabilidad en vez de escribirse, así que el embudo que se ve en pantalla es
 * consecuencia de la simulación y no una tabla de porcentajes disfrazada.
 */
async function sembrarComercial(
  sql: postgres.Sql,
  ctx: {
    clientes: Array<{ id: string; name: string; email: string }>;
    tecnicos: Array<{ id: string; name: string; email: string }>;
    piezas: Pieza[];
    meses: number;
  },
) {
  const { clientes, piezas, meses } = ctx;

  const [tenant] = await sql<[{ id: string }]>`
    select id from public.tenants where slug = ${SLUG}
  `;

  /* ---------- Vendedores ---------- */

  const vendedores = VENDEDORES.map((name, i) => ({
    id: randomUUID(),
    name,
    email: `ventas${i + 1}@${SLUG}.demo`,
    mano: MANO_VENDEDOR[i],
  }));

  await sql`
    insert into public.users ${sql(
      vendedores.map((v) => ({
        id: v.id,
        name: v.name,
        email: v.email,
        active: true,
        created_at: INICIO,
      })),
      "id", "name", "email", "active", "created_at",
    )}
  `;
  await sql`
    insert into public.memberships ${sql(
      vendedores.map((v) => ({
        id: randomUUID(),
        user_id: v.id,
        tenant_id: tenant.id,
        role: "sales" as const,
        active: true,
        accepted_at: INICIO,
        created_at: INICIO,
      })),
      "id", "user_id", "tenant_id", "role", "active", "accepted_at", "created_at",
    )}
  `;

  /* ---------- Organizaciones y contactos ---------- */

  const orgs = clientes.map((c) => ({
    id: randomUUID(),
    name: c.name,
    client_id: c.id,
    owner_id: elige(vendedores).id,
    industry: giroDe(c.name),
    tax_id: `${c.name.replace(/[^A-Za-zÑ]/g, "").slice(0, 3).toUpperCase()}${entero(100000, 999999)}${entero(100, 999)}`,
    phone: `47${entero(10, 99)} ${entero(100, 999)} ${entero(1000, 9999)}`,
    website: `www.${c.email.split("@")[0]}.mx`,
    created_at: INICIO,
  }));
  await enLotes(sql, `${SCHEMA}.crm_organizations`, orgs, [
    "id", "name", "client_id", "owner_id", "industry", "tax_id", "phone",
    "website", "created_at",
  ]);

  const PUESTOS = [
    "Jefe de laboratorio", "Gerente de calidad", "Compras", "Director técnico",
    "Analista senior", "Coordinador de mantenimiento",
  ];
  const NOMBRES = [
    "María", "José", "Ana", "Luis", "Carmen", "Miguel", "Patricia", "Jorge",
    "Rosa", "Alejandro", "Guadalupe", "Ricardo", "Silvia", "Óscar",
  ];
  const APELLIDOS = [
    "Hernández", "García", "Martínez", "López", "Sánchez", "Ramírez", "Torres",
    "Flores", "Rivera", "Gómez", "Díaz", "Vargas",
  ];

  const contactos: Array<{ id: string; orgId: string }> = [];
  const filasContacto: Record<string, unknown>[] = [];
  for (const o of orgs) {
    for (let i = 0; i < entero(1, 3); i++) {
      const id = randomUUID();
      const nombre = `${elige(NOMBRES)} ${elige(APELLIDOS)}`;
      contactos.push({ id, orgId: o.id });
      filasContacto.push({
        id,
        organization_id: o.id,
        name: nombre,
        email: `${nombre.toLowerCase().replace(/[^a-z]/g, ".")}@${o.website.slice(4)}`,
        phone: `47${entero(10, 99)} ${entero(100, 999)} ${entero(1000, 9999)}`,
        position: elige(PUESTOS),
        owner_id: o.owner_id,
        created_at: INICIO,
      });
    }
  }
  await enLotes(sql, `${SCHEMA}.crm_contacts`, filasContacto, [
    "id", "organization_id", "name", "email", "phone", "position", "owner_id",
    "created_at",
  ]);
  console.log(`  clientes (CRM)      ${orgs.length} (${filasContacto.length} contactos)`);

  /* ---------- Etapas del embudo ---------- */

  const etapas = (await sql`
    select s.id, s."order", s.name, s.pipeline_id
      from ${sql.unsafe(SCHEMA)}.crm_stages s
     order by s."order"
  `) as unknown as Array<{ id: string; order: number; name: string; pipeline_id: string }>;
  if (etapas.length === 0) {
    console.log("  ⚠ el embudo no tiene etapas; se omite la siembra de negocios.");
    return;
  }
  const pipelineId = etapas[0].pipeline_id;

  /* ---------- Etiquetas ---------- */

  const etiquetas = [
    { id: randomUUID(), name: "Renovación", color: "#2563eb" },
    { id: randomUUID(), name: "Equipo nuevo", color: "#16a34a" },
    { id: randomUUID(), name: "Urgente", color: "#dc2626" },
    { id: randomUUID(), name: "Licitación", color: "#7c3aed" },
  ];
  await sql`
    insert into ${sql.unsafe(SCHEMA)}.crm_labels ${sql(
      etiquetas.map((e) => ({ ...e, created_at: INICIO })),
      "id", "name", "color", "created_at",
    )}
  `;

  /* ---------- Negocios ---------- */

  const origenes = Object.keys(GANA_POR_ORIGEN) as Origen[];
  const negocios: Record<string, unknown>[] = [];
  const eventos: Record<string, unknown>[] = [];
  const actividades: Record<string, unknown>[] = [];
  const notas: Record<string, unknown>[] = [];
  const partidas: Record<string, unknown>[] = [];
  const etiquetasDeNegocio: Record<string, unknown>[] = [];

  // El ritmo de oportunidades crece con el negocio, como los tickets.
  const totalNegocios = Math.round(meses * 22);
  let nNegocio = 0;

  for (let i = 0; i < totalNegocios; i++) {
    const u = rnd();
    const frac = Math.sqrt(u) * 0.35 + u * 0.65;
    const nace = dias(INICIO, frac * diasEntre(INICIO, FIN));
    if (nace >= FIN) continue;

    const org = elige(orgs);
    const contacto = elige(contactos.filter((c) => c.orgId === org.id));
    const vendedor = vendedores.find((v) => v.id === org.owner_id)!;
    const origen = elige(origenes);

    // El valor: casi todos chicos, unos pocos enormes. Cola larga a propósito.
    // Con suelo de mil pesos: por debajo no hay negocio que registrar, y sin el
    // suelo la cola izquierda llega a cero y rompe el logaritmo de abajo.
    const valor = Math.max(1000, Math.round(lognormal(85_000, 1.4) / 100) * 100);

    /*
      La probabilidad de cierre sale de la verdad plantada: origen × mano del
      vendedor, penalizada por tamaño. No se escribe el resultado, se sortea —
      así el embudo de la pantalla es una consecuencia y no una tabla.
    */
    const decadas = Math.log10(Math.max(valor, 1000) / 85_000);
    const p = Math.min(
      0.9,
      Math.max(
        0.03,
        GANA_POR_ORIGEN[origen] * vendedor.mano - PENALIZACION_POR_DECADA * decadas,
      ),
    );

    /*
      El ciclo se alarga con el tamaño, pero NO se puede encoger sin límite: un
      negocio dos décadas más chico que el típico daba un multiplicador
      negativo, y `lognormal` de una media negativa es NaN — que llegó hasta el
      INSERT como «Invalid time value» y no como un número raro, porque lo
      primero que toca es una fecha.
    */
    const factorCiclo = Math.max(0.25, 1 + CICLO_POR_DECADA * decadas);
    const ciclo = Math.max(3, lognormal(CICLO_BASE * factorCiclo, CV_CICLO));
    const cierre = dias(nace, ciclo);

    const id = randomUUID();
    nNegocio++;

    // Los que aún no habrían cerrado siguen abiertos, en una etapa intermedia.
    const abierto = cierre >= FIN;
    const ganado = !abierto && rnd() < p;
    const estado = abierto ? "open" : ganado ? "won" : "lost";

    // Un negocio abierto está donde le tocaría por el tiempo transcurrido.
    const avance = abierto ? diasEntre(nace, FIN) / ciclo : 1;
    const etapa = abierto
      ? etapas[Math.min(etapas.length - 1, Math.floor(avance * etapas.length))]
      : etapas[etapas.length - 1];

    negocios.push({
      id,
      reference: `NEG-${String(nNegocio).padStart(5, "0")}`,
      title: `${elige(["Refacciones", "Contrato de servicio", "Equipo nuevo", "Calibración anual", "Validación"])} — ${org.name}`,
      pipeline_id: pipelineId,
      stage_id: etapa.id,
      organization_id: org.id,
      contact_id: contacto?.id ?? null,
      owner_id: vendedor.id,
      value_mxn: valor,
      currency: "MXN",
      status: estado,
      lost_reason: estado === "lost" ? elige(MOTIVOS_PERDIDA) : null,
      expected_close_date: cierre.toISOString().slice(0, 10),
      closed_at: abierto ? null : cierre,
      source: origen,
      position: nNegocio,
      created_at: nace,
      updated_at: abierto ? nace : cierre,
    });

    // Los eventos de etapa: es lo que hace que el informe de embudo tenga
    // historia en vez de una foto del estado actual.
    let previa: string | null = null;
    const hasta = etapas.indexOf(etapa);
    for (let k = 0; k <= hasta; k++) {
      eventos.push({
        id: randomUUID(),
        deal_id: id,
        from_stage_id: previa,
        to_stage_id: etapas[k].id,
        status: "open",
        author_id: vendedor.id,
        created_at: dias(nace, (ciclo * k) / Math.max(1, etapas.length)),
      });
      previa = etapas[k].id;
    }
    if (!abierto) {
      eventos.push({
        id: randomUUID(),
        deal_id: id,
        from_stage_id: previa,
        to_stage_id: null,
        status: estado,
        author_id: vendedor.id,
        created_at: cierre,
      });
    }

    // Actividades: llamadas, visitas, correos. Más en los negocios largos.
    for (let a = 0; a < entero(2, 7); a++) {
      const cuando = dias(nace, entre(0, Math.min(ciclo, diasEntre(nace, FIN))));
      if (cuando >= FIN) continue;
      const hecha = cuando < FIN && (abierto ? quizas(0.75) : true);
      actividades.push({
        id: randomUUID(),
        type: pesado({ call: 35, email: 30, meeting: 15, visit: 10, task: 7, demo: 3 }),
        subject: elige(ACTIVIDADES),
        due_at: cuando,
        done: hecha,
        done_at: hecha ? cuando : null,
        deal_id: id,
        contact_id: contacto?.id ?? null,
        organization_id: org.id,
        owner_id: vendedor.id,
        created_by_id: vendedor.id,
        created_at: cuando,
      });
    }

    if (quizas(0.4)) {
      notas.push({
        id: randomUUID(),
        deal_id: id,
        organization_id: org.id,
        author_id: vendedor.id,
        body: elige(NOTAS),
        created_at: dias(nace, entre(0, Math.max(1, Math.min(ciclo, diasEntre(nace, FIN))))),
      });
    }

    if (quizas(0.45)) {
      etiquetasDeNegocio.push({ deal_id: id, label_id: elige(etiquetas).id });
    }

    // Partidas: qué se está vendiendo. Suman aproximadamente el valor.
    let restante = valor;
    for (let l = 0; l < entero(1, 4) && restante > 0; l++) {
      const pieza = elige(piezas);
      const precio = Math.round(pieza.costo * entre(1.35, 1.9));
      const cantidad = Math.max(1, Math.round(restante / Math.max(precio, 1) / 2));
      partidas.push({
        id: randomUUID(),
        deal_id: id,
        part_id: pieza.id,
        name: pieza.descripcion,
        quantity: cantidad,
        unit_price_mxn: precio,
        discount_pct: quizas(0.25) ? entero(3, 15) : 0,
        created_at: nace,
      });
      restante -= precio * cantidad;
    }
  }

  await enLotes(sql, `${SCHEMA}.crm_deals`, negocios, [
    "id", "reference", "title", "pipeline_id", "stage_id", "organization_id",
    "contact_id", "owner_id", "value_mxn", "currency", "status", "lost_reason",
    "expected_close_date", "closed_at", "source", "position", "created_at",
    "updated_at",
  ]);
  await enLotes(sql, `${SCHEMA}.crm_deal_events`, eventos, [
    "id", "deal_id", "from_stage_id", "to_stage_id", "status", "author_id",
    "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.crm_activities`, actividades, [
    "id", "type", "subject", "due_at", "done", "done_at", "deal_id",
    "contact_id", "organization_id", "owner_id", "created_by_id", "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.crm_notes`, notas, [
    "id", "deal_id", "organization_id", "author_id", "body", "created_at",
  ]);
  await enLotes(sql, `${SCHEMA}.crm_deal_labels`, etiquetasDeNegocio, [
    "deal_id", "label_id",
  ]);
  await enLotes(sql, `${SCHEMA}.crm_deal_products`, partidas, [
    "id", "deal_id", "part_id", "name", "quantity", "unit_price_mxn",
    "discount_pct", "created_at",
  ]);

  const ganados = negocios.filter((n) => n.status === "won").length;
  const abiertos = negocios.filter((n) => n.status === "open").length;
  console.log(
    `  negocios            ${negocios.length} (${ganados} ganados, ${abiertos} abiertos)`,
  );
  console.log(`  actividades         ${actividades.length}`);

  /* ---------- Objetivos por vendedor ---------- */

  const objetivos: Record<string, unknown>[] = [];
  for (const v of vendedores) {
    for (let y = INICIO.getFullYear(); y <= FIN.getFullYear(); y++) {
      for (const [q, m] of [[1, 0], [2, 3], [3, 6], [4, 9]] as const) {
        const desde = new Date(Date.UTC(y, m, 1));
        if (desde < INICIO || desde >= FIN) continue;
        objetivos.push({
          id: randomUUID(),
          name: `${y} T${q} · ${v.name.split(" ")[0]}`,
          owner_id: v.id,
          pipeline_id: pipelineId,
          metric: "won_value",
          target: Math.round(lognormal(900_000, 0.25)),
          period_start: desde.toISOString().slice(0, 10),
          period_end: new Date(Date.UTC(y, m + 3, 0)).toISOString().slice(0, 10),
          created_at: desde,
        });
      }
    }
  }
  await enLotes(sql, `${SCHEMA}.crm_goals`, objetivos, [
    "id", "name", "owner_id", "pipeline_id", "metric", "target",
    "period_start", "period_end", "created_at",
  ]);

  /* ---------- Prospectos entrantes ---------- */

  const prospectos: Record<string, unknown>[] = [];
  for (let i = 0; i < meses * 9; i++) {
    const u = rnd();
    const cuando = dias(INICIO, (Math.sqrt(u) * 0.35 + u * 0.65) * diasEntre(INICIO, FIN));
    if (cuando >= FIN) continue;
    const nombre = `${elige(NOMBRES)} ${elige(APELLIDOS)}`;
    prospectos.push({
      id: randomUUID(),
      name: nombre,
      email: `${nombre.toLowerCase().replace(/[^a-z]/g, ".")}${i}@correo.mx`,
      company: elige(CLIENTES),
      message: elige(MENSAJES_PROSPECTO),
      // La mayoría muere sin contestar: es lo que pasa de verdad, y un embudo
      // de prospectos donde casi todos califican no enseña a priorizar nada.
      status: pesado({ new: 30, contacted: 28, qualified: 20, lost: 17, won: 5 }),
      score: entero(10, 95),
      source: elige(["Sitio web", "Campaña de correo", "Feria del sector", "Referido"]),
      created_at: cuando,
    });
  }
  await enLotes(sql, `${SCHEMA}.leads`, prospectos, [
    "id", "name", "email", "company", "message", "status", "score", "source",
    "created_at",
  ]);
  console.log(`  prospectos          ${prospectos.length}`);

  /* ---------- Catálogo público del sitio ---------- */

  const marcasSitio = (Object.keys(MARCA) as Marca[]).map((name, i) => ({
    id: randomUUID(),
    name,
    website: `https://www.${name.toLowerCase().replace(/\s/g, "")}.com`,
    order: i,
  }));
  await sql`
    insert into ${sql.unsafe(SCHEMA)}.brands ${sql(marcasSitio, "id", "name", "website", "order")}
  `;

  const productos = (Object.keys(RITMO_EQUIPO) as TipoEquipo[]).flatMap((tipo, i) =>
    marcasSitio.slice(0, 4).map((m, j) => ({
      id: randomUUID(),
      slug: `${tipo.toLowerCase().replace(/[^a-z]/g, "-")}-${m.name.toLowerCase().replace(/\s/g, "")}`.replace(/-+/g, "-"),
      name_es: `${tipo} ${m.name}`,
      name_en: `${tipo} ${m.name}`,
      desc_es: `${tipo} de la marca ${m.name}, con servicio y refacciones en México.`,
      desc_en: `${m.name} ${tipo}, serviced and stocked in Mexico.`,
      brand_id: m.id,
      published: true,
      _o: i * 10 + j,
    })),
  );
  await enLotes(
    sql,
    `${SCHEMA}.products`,
    productos.map(({ _o, ...p }) => p),
    ["id", "slug", "name_es", "name_en", "desc_es", "desc_en", "brand_id", "published"],
  );

  const servicios = [
    ["mantenimiento-preventivo", "Mantenimiento preventivo", "Preventive maintenance"],
    ["calibracion", "Calibración y verificación", "Calibration and verification"],
    ["calificacion-iq-oq", "Calificación IQ/OQ/PQ", "IQ/OQ/PQ qualification"],
    ["refacciones", "Venta de refacciones", "Spare parts"],
    ["capacitacion", "Capacitación a usuarios", "User training"],
    ["reparacion", "Reparación correctiva", "Corrective repair"],
    ["contratos", "Contratos de servicio", "Service contracts"],
  ].map(([slug, es, en], i) => ({
    id: randomUUID(),
    slug,
    title_es: es,
    title_en: en,
    desc_es: `${es} para equipo de laboratorio analítico, con reporte y trazabilidad.`,
    desc_en: `${en} for analytical laboratory instruments, fully documented.`,
    order: i,
    published: true,
  }));
  await enLotes(sql, `${SCHEMA}.services`, servicios, [
    "id", "slug", "title_es", "title_en", "desc_es", "desc_en", "order", "published",
  ]);
  console.log(
    `  catálogo del sitio  ${productos.length} productos · ${servicios.length} servicios · ${marcasSitio.length} marcas`,
  );
}

const MOTIVOS_PERDIDA = [
  "Precio por encima del competidor",
  "El cliente pospuso el presupuesto",
  "Se fue con el fabricante directo",
  "No hubo respuesta tras la cotización",
  "Requería tiempo de entrega menor",
];

const ACTIVIDADES = [
  "Llamada de seguimiento",
  "Envío de cotización",
  "Visita técnica al laboratorio",
  "Demostración de equipo",
  "Revisión de alcance",
  "Confirmar disponibilidad de refacción",
  "Negociar tiempo de entrega",
];

const NOTAS = [
  "El cliente pidió desglosar refacciones y mano de obra por separado.",
  "Compras exige orden de compra antes del servicio; ajustar tiempos.",
  "Tienen equipo de otra marca sin cubrir: oportunidad para el próximo año.",
  "Presupuesto se libera hasta el siguiente trimestre.",
  "Pidieron referencia de otro laboratorio del sector.",
];

const MENSAJES_PROSPECTO = [
  "Necesito cotización de mantenimiento para un HPLC.",
  "¿Dan servicio a equipos fuera de garantía?",
  "Buscamos calibración con trazabilidad para auditoría.",
  "Requerimos refacciones urgentes, el equipo está parado.",
  "¿Manejan contratos anuales para varios equipos?",
];

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
