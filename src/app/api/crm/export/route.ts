import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isSalesRole, isAdminRole } from "@/lib/roles";
import { crmContacts, crmDeals, crmOrganizations } from "@/lib/db/schema";
import { currentRole, tenantDb } from "@/lib/tenancy/context";
import { diaCivil, hoyCivil } from "@/lib/fechas";

/** Escapa un campo para CSV (comillas dobles y separadores). */
function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]) {
  // BOM para que Excel en Windows respete los acentos.
  return (
    "﻿" +
    [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}

/**
 * Exportación CSV del CRM: /api/crm/export?tipo=negocios|organizaciones|contactos
 * Restringido al área comercial. El vendedor exporta solo su cartera.
 *
 * Se consulta con `tenantDb()` y no con `getDb()`.
 *
 * No es un detalle de estilo: `getDb()` habla con el plano de control, donde
 * las tablas del CRM sencillamente no existen. Esta ruta se quedó atrás en la
 * mudanza de las tablas de negocio al esquema del inquilino, y el síntoma era
 * un 500 con `relation "crm_deals" does not exist` en los tres tipos de
 * exportación — es decir, el botón «Exportar» del informe llevaba roto desde
 * entonces. Era el último sitio del código con esa mezcla.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!isSalesRole(await currentRole())) {
    return new NextResponse("No autorizado", { status: 403 });
  }
  const admin = isAdminRole(await currentRole());
  const ownerId = admin ? undefined : session!.user.id;

  const tipo = new URL(request.url).searchParams.get("tipo") ?? "negocios";
  const db = await tenantDb();
  let csv: string;
  let filename: string;

  if (tipo === "organizaciones") {
    const rows = await db.query.crmOrganizations.findMany({
      where: ownerId ? eq(crmOrganizations.ownerId, ownerId) : undefined,
      orderBy: [crmOrganizations.name],
      with: { owner: { columns: { name: true, email: true } } },
    });
    csv = toCsv(
      ["Nombre", "Giro", "Teléfono", "Sitio web", "Dirección", "Responsable"],
      rows.map((o) => [
        o.name,
        o.industry,
        o.phone,
        o.website,
        o.address,
        o.owner?.name ?? o.owner?.email,
      ]),
    );
    filename = "organizaciones";
  } else if (tipo === "contactos") {
    const rows = await db.query.crmContacts.findMany({
      where: ownerId ? eq(crmContacts.ownerId, ownerId) : undefined,
      orderBy: [crmContacts.name],
      with: {
        organization: { columns: { name: true } },
        owner: { columns: { name: true, email: true } },
      },
    });
    csv = toCsv(
      ["Nombre", "Puesto", "Correo", "Teléfono", "Organización", "Responsable"],
      rows.map((c) => [
        c.name,
        c.position,
        c.email,
        c.phone,
        c.organization?.name,
        c.owner?.name ?? c.owner?.email,
      ]),
    );
    filename = "contactos";
  } else {
    const rows = await db.query.crmDeals.findMany({
      where: ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      orderBy: [desc(crmDeals.createdAt)],
      with: {
        stage: { columns: { name: true } },
        organization: { columns: { name: true } },
        contact: { columns: { name: true } },
        owner: { columns: { name: true, email: true } },
      },
    });
    csv = toCsv(
      [
        "Folio",
        "Título",
        "Etapa",
        "Estado",
        "Valor MXN",
        "Valor USD",
        "Organización",
        "Contacto",
        "Responsable",
        "Cierre estimado",
        "Origen",
        "Motivo de pérdida",
        "Creado",
      ],
      rows.map((d) => [
        d.reference,
        d.title,
        d.stage?.name,
        d.status,
        d.valueMxn,
        d.valueUsd,
        d.organization?.name,
        d.contact?.name,
        d.owner?.name ?? d.owner?.email,
        d.expectedCloseDate,
        d.source,
        d.lostReason,
        // Por `diaCivil` y no por `toISOString`: un negocio creado a las 19:00
        // hora de México se exportaba con la fecha del día siguiente.
        diaCivil(d.createdAt),
      ]),
    );
    filename = "negocios";
  }

  const stamp = hoyCivil();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="evoelution-${filename}-${stamp}.csv"`,
    },
  });
}
