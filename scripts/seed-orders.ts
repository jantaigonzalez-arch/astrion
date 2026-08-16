/**
 * Siembra de la cadena comercial completa: negocio → pedido → requisición →
 * orden de compra.
 *
 *   npm run db:seed:orders            (empresa por omisión: evoelution)
 *   SEED_TENANT=acme npm run db:seed:orders
 *
 * `db:seed:crm` deja el embudo con negocios abiertos y ahí se acaba. Esto lo
 * continúa: pone renglones a esos negocios —sin productos no hay nada que
 * surtir, así que ganarlos no enseñaría nada— y añade PEDIDOS, que son negocios
 * ya ganados, elegidos para que cada estado del circuito se pueda ver:
 *
 *   1. surtido con existencia    no hace falta comprar nada
 *   2. por requisitar            falta de tres refacciones, de dos proveedores
 *   3. en compras                requisición autorizada y convertida en órdenes,
 *                                con un renglón sin catalogar que la deja parcial
 *
 * Las requisiciones y las órdenes NO se insertan a mano: se crean llamando al
 * dominio (`createRequisitionFromDeal`, `approveRequisition`,
 * `convertToPurchaseOrders`), que es la única forma de que los datos de
 * demostración cumplan las mismas reglas que los de verdad. Una siembra que
 * escribe filas directamente acaba produciendo estados que la aplicación no
 * puede generar, y entonces la demo enseña algo que no existe.
 *
 * Es idempotente: si ya hay pedidos con productos, no hace nada.
 */
import "./_env";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenantDbFor } from "@/lib/tenancy/context";
import {
  crmContacts,
  crmDealEvents,
  crmDealProducts,
  crmDeals,
  crmOrganizations,
  crmPipelines,
  crmStages,
  spareParts,
} from "@/lib/db/schema";
import { memberships, tenants, tenantSchemas, users } from "@/lib/db/platform";
import { nextDealReference } from "@/lib/domain/references";
import {
  approveRequisition,
  convertToPurchaseOrders,
  createRequisitionFromDeal,
  submitRequisition,
} from "@/lib/domain/requisitions";

const SLUG = process.env.SEED_TENANT ?? "evoelution";

/** Renglón de un negocio, por número de parte para que se lea. */
type Renglon = { parte: string | null; nombre?: string; cantidad: number };

/**
 * Los pedidos, y por qué cada uno.
 *
 * Las cantidades van en función de la existencia sembrada (`stock + n`), no en
 * absoluto: si mañana el seed de refacciones cambia las existencias, un 16
 * clavado dejaría de demostrar lo que vino a demostrar.
 */
const PEDIDOS: Array<{
  titulo: string;
  valor: string;
  cerradoHace: number;
  renglones: Renglon[];
  /** Llevarlo hasta órdenes de compra. */
  hastaOrdenes?: boolean;
}> = [
  {
    titulo: "Renovación de consumibles de cromatografía 2026",
    valor: "78400",
    cerradoHace: 21,
    // Todo cabe en almacén: el pedido se surte sin comprar nada. Es el caso
    // que demuestra para qué sirve la resta, porque sin ella se habrían
    // comprado 27 piezas que ya estaban.
    renglones: [
      { parte: "SEP-PTFE-100", cantidad: 10 },
      { parte: "VIA-2ML-100", cantidad: 12 },
      { parte: "TUB-PEEK-16", cantidad: 5 },
    ],
  },
  {
    titulo: "Kit de refacciones para tres bombas analíticas",
    valor: "246000",
    cerradoHace: 9,
    // Tres renglones elegidos para que al convertir salgan DOS órdenes y no
    // una: el cabezal se le compra al Bajío y la jeringa a Cromatografía. El
    // tercero —el sello de rotor— está pedido a un proveedor y todavía sin
    // llegar, así que se cubre con lo que viene y NO se compra: es el renglón
    // que demuestra que la columna «Viene» hace trabajo de verdad.
    renglones: [
      { parte: "AGI0101-0301", cantidad: -4 },
      { parte: "SHI228-32800", cantidad: -5 },
      { parte: "ROT-SEAL-6P", cantidad: -3 },
    ],
  },
  {
    titulo: "Actualización de detector UV y lámpara",
    valor: "192500",
    cerradoHace: 4,
    hastaOrdenes: true,
    renglones: [
      { parte: "DET-CELL-UV", cantidad: -4 },
      { parte: "AGI5062-8535", cantidad: -4 },
      // Sin catalogar a propósito: es lo que deja la requisición en «parcial»
      // con su aviso en ámbar, que es el estado que más se da en la práctica y
      // el que nadie diseña.
      { parte: null, nombre: "Bomba del 1525, la de siempre", cantidad: 2 },
    ],
  },
];

/** Renglones para los negocios ABIERTOS, para poder ganarlos y ver el efecto. */
const ABIERTOS: Renglon[][] = [
  [
    { parte: "WAT270919", cantidad: 6 },
    { parte: "WAT700002", cantidad: 4 },
  ],
  [
    { parte: "SHI228-32800", cantidad: 8 },
    { parte: "SHI228-45000", cantidad: 10 },
  ],
  [{ parte: "FIT-UNION-10", cantidad: 12 }],
  [
    { parte: "COL-C18-250", cantidad: 6 },
    { parte: "SEP-PTFE-100", cantidad: 8 },
  ],
];

async function main() {
  const control = getDb();

  const [inquilino] = await control
    .select({
      id: tenants.id,
      folioPrefix: tenants.folioPrefix,
      schemaName: tenantSchemas.schemaName,
    })
    .from(tenants)
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(eq(tenants.slug, SLUG))
    .limit(1);

  if (!inquilino?.schemaName) {
    throw new Error(
      `No existe el inquilino "${SLUG}" o no tiene esquema. ` +
        `Créalo antes:  npx tsx scripts/tenant.ts provision --slug ${SLUG}`,
    );
  }

  const [dueño] = await control
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, inquilino.id),
        eq(memberships.active, true),
        inArray(memberships.role, ["owner", "admin", "sales"]),
      ),
    )
    .limit(1);

  const prefijo = inquilino.folioPrefix ?? "EVO";
  const db = tenantDbFor(inquilino.schemaName);

  await db.transaction(async (tx) => {
    const [pipeline] = await tx
      .select()
      .from(crmPipelines)
      .orderBy(asc(crmPipelines.order))
      .limit(1);
    if (!pipeline) {
      throw new Error("No hay embudo. Corre antes:  npm run db:seed:crm");
    }

    const etapas = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipeline.id))
      .orderBy(asc(crmStages.order));

    const [{ ganados }] = (await tx
      .select({
        ganados: sql<number>`count(*) filter (where ${crmDeals.status} = 'won')::int`,
      })
      .from(crmDeals)) as Array<{ ganados: number }>;

    if (ganados > 0) {
      console.log(`· Ya hay ${ganados} pedido(s); no se siembra nada.`);
      return;
    }

    const partes = await tx
      .select({
        id: spareParts.id,
        partNumber: spareParts.partNumber,
        description: spareParts.description,
        stock: spareParts.stock,
        priceMxn: spareParts.priceMxn,
      })
      .from(spareParts);
    const porNumero = new Map(partes.map((p) => [p.partNumber, p]));

    /** Traduce un renglón declarado a una fila de `crm_deal_products`. */
    const filaDe = (dealId: string, r: Renglon) => {
      if (!r.parte) {
        return {
          dealId,
          partId: null,
          name: r.nombre ?? "Sin especificar",
          quantity: String(r.cantidad),
          unitPriceMxn: "0",
        };
      }
      const p = porNumero.get(r.parte);
      if (!p) throw new Error(`No existe la refacción ${r.parte}`);
      // Cantidad negativa = «tantas MÁS de las que hay». Ver la nota de arriba.
      const cantidad = r.cantidad < 0 ? p.stock - r.cantidad : r.cantidad;
      return {
        dealId,
        partId: p.id,
        name: p.description,
        quantity: String(cantidad),
        unitPriceMxn: p.priceMxn ?? "0",
      };
    };

    // ---- 1) Renglones a los negocios abiertos que no tengan ----------------
    const abiertos = await tx
      .select({ id: crmDeals.id, reference: crmDeals.reference })
      .from(crmDeals)
      .leftJoin(crmDealProducts, eq(crmDealProducts.dealId, crmDeals.id))
      .where(and(eq(crmDeals.status, "open"), isNull(crmDealProducts.id)))
      .orderBy(asc(crmDeals.createdAt));

    for (let i = 0; i < abiertos.length; i++) {
      const renglones = ABIERTOS[i % ABIERTOS.length];
      await tx
        .insert(crmDealProducts)
        .values(renglones.map((r) => filaDe(abiertos[i].id, r)));
    }
    if (abiertos.length) {
      console.log(`· ${abiertos.length} negocio(s) abierto(s) con renglones.`);
    }

    // ---- 2) Los pedidos ----------------------------------------------------
    const [org] = await tx.select().from(crmOrganizations).limit(1);
    const [contacto] = await tx.select().from(crmContacts).limit(1);
    const cierre = etapas[etapas.length - 1];

    for (const p of PEDIDOS) {
      const cerradoEl = new Date();
      cerradoEl.setDate(cerradoEl.getDate() - p.cerradoHace);

      const reference = await nextDealReference(tx, prefijo);
      const [deal] = await tx
        .insert(crmDeals)
        .values({
          reference,
          title: p.titulo,
          pipelineId: pipeline.id,
          stageId: cierre.id,
          organizationId: org?.id ?? null,
          contactId: contacto?.id ?? null,
          ownerId: dueño?.id ?? null,
          valueMxn: p.valor,
          status: "won",
          closedAt: cerradoEl,
          source: "cliente_existente",
        })
        .returning({ id: crmDeals.id });

      await tx
        .insert(crmDealProducts)
        .values(p.renglones.map((r) => filaDe(deal.id, r)));

      await tx.insert(crmDealEvents).values({
        dealId: deal.id,
        toStageId: cierre.id,
        status: "won",
        authorId: dueño?.id ?? null,
      });

      console.log(`· Pedido ${reference} — ${p.titulo}`);

      if (!p.hastaOrdenes) continue;

      // ---- 3) Circuito completo, por el dominio --------------------------
      const req = await createRequisitionFromDeal(tx, {
        dealId: deal.id,
        actorId: dueño?.id ?? null,
        neededBy: enDias(21),
        folioPrefix: prefijo,
      });
      if (!req.ok) throw new Error(`No se pudo requisitar: ${req.reason}`);
      console.log(`    → requisición ${req.reference} (${req.lineas} renglones)`);

      await submitRequisition(tx, { id: req.id, actorId: dueño?.id ?? null });
      await approveRequisition(tx, { id: req.id, actorId: dueño?.id ?? null });

      const conv = await convertToPurchaseOrders(tx, {
        id: req.id,
        actorId: dueño?.id ?? null,
        folioPrefix: prefijo,
      });
      if (!conv.ok) throw new Error(`No se pudo convertir: ${conv.reason}`);
      for (const o of conv.orders) {
        console.log(`    → orden ${o.reference} · ${o.supplier}`);
      }
      for (const o of conv.omitidas) {
        console.log(`    → sin convertir: ${o.description} (${o.reason})`);
      }
    }

    console.log(`\n✓ Cadena sembrada en ${inquilino.schemaName}.`);
  });

  process.exit(0);
}

function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
