/**
 * CARGA EL INVENTARIO DE REFACCIONES desde el reporte «Existencias y costos
 * actuales» del ERP anterior.
 *
 *   # 1. el .xlsx a CSV (una sola hoja):
 *   soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,76,1' \
 *     --outdir /tmp/inv "REPORTE DE INVENTARIO CON COSTOS.xlsx"
 *
 *   # 2. ensayo: lee, cuadra, cruza contra la base y dice qué haría
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/importar-inventario.ts \
 *     --csv /tmp/inv/REPORTE*.csv --tenant evoelution
 *
 *   # 3. lo mismo, escribiendo
 *   … --aplicar
 *
 *   `--csv -` lee de la entrada estándar, para mandarlo al servidor sin dejar
 *   el archivo allá:  ssh srv '… --csv - --tenant evoelution' < reporte.csv
 *
 * ── ENSAYO POR OMISIÓN ─────────────────────────────────────────────────────
 *
 * Sin `--aplicar` no escribe nada. Con él, todo va en UNA transacción: o entra
 * el inventario completo o no entra nada.
 *
 * ── QUÉ HACE CON CADA PRODUCTO ─────────────────────────────────────────────
 *
 *  · NUEVO (su código no está en el catálogo) → se da de alta con descripción
 *    y costo promedio, y su existencia entra como movimiento de APERTURA con la
 *    fecha del reporte en la nota. Igual que el alta a mano (`createPart`): la
 *    refacción nace en 0 y el saldo es la suma del ledger.
 *  · YA EXISTE → no se le toca la existencia. Ya tiene movimientos propios, y
 *    ajustarla a la foto del reporte borraría lo que pasó después. Solo se le
 *    completa el costo si no lo tenía. Si la existencia no coincide, sale en el
 *    reporte de incidencias para que alguien decida.
 *
 * Eso lo hace además IDEMPOTENTE: la segunda corrida encuentra todo creado y no
 * mueve una pieza.
 *
 * ── LO QUE EL REPORTE TRAE Y EL CATÁLOGO NO GUARDA ─────────────────────────
 *
 * La fecha y el costo de la última compra no tienen columna en `spare_parts`.
 * No se tiran: van en el evento `part.imported` de cada refacción, con la fila
 * original entera, así que se puede responder «de dónde salió este dato» sin
 * volver al archivo.
 *
 * Las incidencias —códigos repetidos, descripciones cortadas, existencias sin
 * costo— se escriben a un CSV en `.sync/`, que está ignorado: son datos de la
 * empresa y este repositorio es público.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { tenantDbFor } from "../src/lib/tenancy/context";
import { companies, schemaNameFor, tenants } from "../src/lib/db/platform";
import { domainEvents, spareParts } from "../src/lib/db/schema";
import { applyInventoryMovement } from "../src/lib/domain/inventory";
import { parseCsvFilas } from "../src/lib/import/csv";
import {
  consolidar,
  cuadrar,
  leerReporteExistencias,
  type Incidencia,
} from "../src/lib/import/reporte-existencias";

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const aplicar = args.includes("--aplicar");
  const archivo = flag("csv");
  const slug = flag("tenant");
  const salida = flag("reporte") ?? ".sync/inventario-incidencias.csv";

  if (!archivo || !slug) {
    console.error("Uso: importar-inventario.ts --csv <archivo.csv | -> --tenant <slug> [--aplicar]");
    process.exit(1);
  }

  const texto = readFileSync(archivo === "-" ? 0 : archivo, "utf8");
  const rep = leerReporteExistencias(parseCsvFilas(texto));

  console.log(`▸ Reporte del ${rep.fechaHora ?? "?"} · importes en ${rep.moneda ?? "?"}`);
  console.log(`  ${rep.productos.length} productos leídos; el pie dice ${rep.pie.registros ?? "?"}`);

  const errores = cuadrar(rep);
  if (errores.length) {
    console.error("\n✗ El reporte no cuadra con su propio pie. No se carga nada:");
    for (const e of errores) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log("  ✓ cuadra con el pie: registros, piezas y costo total");

  const { partes, incidencias: deConsolidar } = consolidar(rep.productos);
  const incidencias: Incidencia[] = [...rep.incidencias, ...deConsolidar];

  const db = tenantDbFor(schemaNameFor(slug));
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    console.error(`✗ No existe el inquilino «${slug}».`);
    process.exit(1);
  }
  const [empresa] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.tenantId, tenant.id))
    .limit(1);

  // Lo que ya hay, por el mismo código normalizado con el que se compara.
  const existentes = new Map(
    (
      await db
        .select({
          id: spareParts.id,
          codigo: sql<string>`upper(trim(${spareParts.partNumber}))`,
          costMxn: spareParts.costMxn,
          stock: spareParts.stock,
        })
        .from(spareParts)
    ).map((p) => [p.codigo, p]),
  );

  const nuevas = partes.filter((p) => !existentes.has(p.codigo));
  const yaEstan = partes.filter((p) => existentes.has(p.codigo));
  const completarCosto = yaEstan.filter((p) => !existentes.get(p.codigo)!.costMxn && p.costoMxn);
  for (const p of yaEstan) {
    const e = existentes.get(p.codigo)!;
    if (e.stock !== p.existencia) {
      incidencias.push({
        fila: p.origen[0].fila,
        codigo: p.codigo,
        tipo: "ya existía con otra existencia",
        detalle: `en el sistema ${e.stock}, en el reporte ${p.existencia}: no se ajusta, ya tiene movimientos propios`,
      });
    }
  }
  const aperturas = nuevas.filter((p) => p.existencia > 0);
  const piezas = aperturas.reduce((s, p) => s + p.existencia, 0);

  // Cuántas de las refacciones anotadas en tickets encuentran aquí su ficha.
  const anotados = (
    (await db.execute(
      sql`select distinct upper(trim(part_number)) as codigo from ticket_comment_parts`,
    )) as unknown as Array<{ codigo: string }>
  ).map((r) => r.codigo);
  const codigos = new Set(partes.map((p) => p.codigo));
  const usados = anotados.length;
  const encontrados = anotados.filter((c) => codigos.has(c)).length;

  console.log(`\n▸ Plan contra «${slug}»`);
  console.log(`  ${partes.length} refacciones (de ${rep.productos.length} filas: los códigos repetidos se juntan)`);
  console.log(`  ${nuevas.length} nuevas · ${yaEstan.length} ya estaban (${completarCosto.length} reciben su costo)`);
  console.log(`  ${aperturas.length} con existencia → ${piezas} piezas como movimiento de apertura`);
  console.log(`  ${nuevas.filter((p) => !p.costoMxn).length} sin costo (el reporte dice 0)`);
  console.log(`  refacciones anotadas en tickets que encuentran su ficha: ${encontrados} de ${usados}`);

  const porTipo = new Map<string, number>();
  for (const i of incidencias) porTipo.set(i.tipo, (porTipo.get(i.tipo) ?? 0) + 1);
  console.log(`\n▸ ${incidencias.length} incidencias → ${salida}`);
  for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${t}`);

  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  mkdirSync(dirname(salida), { recursive: true });
  writeFileSync(
    salida,
    ["fila,codigo,tipo,detalle", ...incidencias.map((i) => [i.fila, i.codigo, i.tipo, i.detalle].map(csv).join(","))].join("\n"),
  );

  if (!aplicar) {
    console.log("\n· Ensayo: no se escribió nada. Repetir con --aplicar para cargar.");
    process.exit(0);
  }

  const nota = `Saldo inicial: reporte «Existencias y costos actuales» del ${rep.fechaHora ?? "ERP anterior"}`;
  const inicio = Date.now();

  await db.transaction(async (tx) => {
    const creadas = new Map<string, string>();
    for (let i = 0; i < nuevas.length; i += 500) {
      const lote = nuevas.slice(i, i + 500);
      const filas = await tx
        .insert(spareParts)
        .values(
          lote.map((p) => ({
            partNumber: p.codigo,
            description: p.descripcion,
            costMxn: p.costoMxn,
            // Nace en 0: la existencia entra abajo como movimiento.
            stock: 0,
          })),
        )
        .onConflictDoNothing({ target: spareParts.partNumber })
        .returning({ id: spareParts.id, codigo: spareParts.partNumber });
      for (const f of filas) creadas.set(f.codigo, f.id);
    }
    // Si otra sesión dio de alta alguno entre el ensayo y ahora, `onConflict` lo
    // habría saltado en silencio. Se prefiere abortar y volver a ensayar.
    if (creadas.size !== nuevas.length) {
      throw new Error(`se esperaban ${nuevas.length} altas y entraron ${creadas.size}: vuelva a ensayar`);
    }

    for (const p of aperturas) {
      await applyInventoryMovement(tx, {
        partId: creadas.get(p.codigo)!,
        kind: "opening",
        quantity: p.existencia,
        unitCostMxn: p.costoMxn,
        note: nota,
        companyId: empresa?.id ?? null,
      });
    }

    for (const p of completarCosto) {
      await tx
        .update(spareParts)
        .set({ costMxn: p.costoMxn, updatedAt: new Date() })
        .where(and(eq(spareParts.id, existentes.get(p.codigo)!.id), sql`${spareParts.costMxn} is null`));
    }

    const eventos = [
      ...nuevas.map((p) => ({ id: creadas.get(p.codigo)!, tipo: "part.imported", p })),
      ...completarCosto.map((p) => ({ id: existentes.get(p.codigo)!.id, tipo: "part.cost_imported", p })),
    ];
    for (let i = 0; i < eventos.length; i += 500) {
      await tx.insert(domainEvents).values(
        eventos.slice(i, i + 500).map((e) => ({
          aggregateType: "spare_part",
          aggregateId: e.id,
          eventType: e.tipo,
          payload: { reporte: rep.fechaHora, origen: e.p.origen },
          companyId: empresa?.id ?? null,
        })),
      );
    }

    // La comprobación final, dentro de la transacción: si no da, no se confirma.
    const [{ n, suma }] = await tx
      .select({ n: sql<number>`count(*)::int`, suma: sql<number>`coalesce(sum(${spareParts.stock}), 0)::int` })
      .from(spareParts)
      .where(inArray(spareParts.id, [...creadas.values()]));
    if (n !== nuevas.length || suma !== piezas) {
      throw new Error(`comprobación final: ${n} refacciones con ${suma} piezas; se esperaban ${nuevas.length} con ${piezas}`);
    }
  });

  console.log(`\n✓ Cargado en ${((Date.now() - inicio) / 1000).toFixed(1)} s: ${nuevas.length} refacciones, ${piezas} piezas en ${aperturas.length} aperturas.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
