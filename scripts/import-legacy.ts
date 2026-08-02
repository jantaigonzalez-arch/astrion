/**
 * Importación del sistema anterior (4 CSV) a la base de Evoelution.
 *
 *   npx tsx scripts/import-legacy.ts --dir <carpeta> --tenant <slug> [--dry-run] [--wipe]
 *
 * Propiedades del importador, en orden de importancia:
 *
 *  · TRANSACCIONAL. Todo ocurre dentro de un `db.transaction`. Si algo falla a
 *    mitad no queda una base a medio migrar, que es el peor estado posible.
 *  · IDEMPOTENTE con --wipe: borra lo importable y vuelve a cargar. Sin --wipe
 *    aborta si encuentra datos, para no duplicar por un doble enter.
 *  · AUDITABLE. Cada registro deja un evento `*.imported` en domain_events con
 *    la fila cruda del CSV en el payload. Después se puede responder "de dónde
 *    salió este dato" sin volver al archivo.
 *  · NADA SE INVENTA. Lo que no se puede deducir queda fuera y se reporta.
 *
 * OJO con --wipe: borra los datos importables pero NO la bitácora, que es
 * append-only por diseño (un trigger de Postgres rechaza UPDATE y DELETE). Al
 * reimportar quedan eventos de la corrida anterior apuntando a filas que ya no
 * existen. Es lo correcto para una auditoría —el intento anterior ocurrió de
 * verdad— pero conviene reimportar pocas veces sobre una base que ya opera.
 *
 * Genera `import-report.csv` con cada incidencia para que el equipo la corrija
 * desde la UI.
 */
import "./_env"; // DEBE ir primero: ver el comentario en scripts/_env.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { tenantDbFor } from "../src/lib/tenancy/context";
import { schemaNameFor } from "../src/lib/db/platform";
import {
  contractEquipment,
  contracts,
  commentParts,
  crmOrganizations,
  domainEvents,
  equipment,
  equipmentModules,
  ticketComments,
  tickets,
} from "../src/lib/db/schema";
import { companies, users } from "../src/lib/db/platform";

/* ===================== utilidades de parseo ===================== */

/** CSV con comillas dobles, saltos de línea embebidos y BOM. */
function parseCsv(text: string): Record<string, string>[] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  return body.map((r) =>
    Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])),
  );
}

/**
 * Fechas del origen: mm/dd/yyyy. Verificado sobre los 4 archivos — 337 fechas
 * tienen el segundo campo > 12 y NINGUNA tiene el primero > 12. Es formato de
 * EE.UU., no día/mes.
 */
function parseDate(v: string): Date | null {
  const m = (v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** "$2,135,358.60" | " USD 3,253.80 " | "22,382.40" → "2135358.60" */
function parseMoney(v: string): string | null {
  const clean = (v || "").replace(/[^0-9.]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

/** Normaliza el nombre de un cliente para cruzar entre archivos. */
function normName(s: string): string {
  return (s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\b(S\s*A\s*P\s*I|SA DE CV|S A DE C V|SAPI DE CV|SA|CV|DE|SC|SRL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const slug = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

/**
 * Excel convirtió números de serie pegados en un solo número y les puso
 * separador de miles: "15,622,120,231,422,200,000" no son 7 valores, es
 * "15622 12023 14222 00000". Se recupera casando codiciosamente contra el
 * catálogo real de series; lo que no case se reporta en vez de adivinarse.
 */
function splitSeries(raw: string, known: Set<string>): { ok: string[]; bad: string[] } {
  const v = (raw || "").trim();
  if (!v) return { ok: [], bad: [] };

  const parts = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const allNumericFragments =
    parts.length > 1 && parts.every((p) => /^\d{1,3}$/.test(p));

  if (!allNumericFragments) {
    const ok: string[] = [];
    const bad: string[] = [];
    for (const p of parts) (known.has(p.toUpperCase()) ? ok : bad).push(p);
    return { ok, bad };
  }

  // Corrupción por separador de miles: reconstruir y cortar por coincidencia.
  const digits = parts.join("");
  const ok: string[] = [];
  let i = 0;
  while (i < digits.length) {
    // Relleno de celdas vacías: Excel dejó ceros al final. Ninguna máquina
    // tiene número de serie de puros ceros, así que se descarta sin adivinar.
    if (/^0+$/.test(digits.slice(i))) break;
    let matched = false;
    for (let len = Math.min(12, digits.length - i); len >= 3; len--) {
      const cand = digits.slice(i, i + len);
      if (known.has(cand)) { ok.push(cand); i += len; matched = true; break; }
    }
    if (!matched) return { ok: [], bad: [v] }; // no se pudo: se reporta entero
  }
  return { ok, bad: [] };
}

/** Los números de parte sufren la misma corrupción; aquí son de 9 dígitos. */
function splitParts(raw: string): string[] {
  const v = (raw || "").trim();
  if (!v || v === "[]") return [];
  if (/^[\d,]+$/.test(v) && v.includes(",")) {
    const d = v.replace(/,/g, "");
    if (d.length % 9 === 0) {
      return Array.from({ length: d.length / 9 }, (_, i) =>
        d.slice(i * 9, i * 9 + 9),
      );
    }
    return [v]; // no cuadra: se conserva crudo y se reporta
  }
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

/* ===================== mapeos de dominio ===================== */

const STATUS: Record<string, "open" | "in_progress" | "closed" | "rejected"> = {
  New: "open",
  "In progress": "in_progress",
  Completed: "closed",
  Duplicate: "rejected",
};

const PRIORITY: Record<string, "low" | "medium" | "high" | "urgent"> = {
  Low: "low",
  Normal: "medium",
  High: "high",
  Critical: "urgent",
};

/** Primer elemento de la clasificación del origen → categoría del sistema. */
const CATEGORY: Record<string, "maintenance" | "validation" | "support" | "other"> = {
  "Preventive and corrective": "maintenance",
  Calification: "validation", // calificación IQ/OQ/PQ
  "Computer Software": "support",
  Critical: "other", // en el origen es severidad, no categoría
  Otro: "other",
};

/**
 * Correos del staff. `ruben.barrios@evoelution.com` está confirmado (aparece en
 * SAE); los demás siguen la misma convención pero SON UNA SUPOSICIÓN — van en
 * el reporte para que los verifiquen antes de invitar a nadie.
 */
const TECH_EMAIL: Record<string, string> = {
  "Rubén  Barrios Borja": "ruben.barrios@evoelution.com",
  "Aranza  Canto Ramírez": "aranza.canto@evoelution.com",
  "Luis Vicente Escobedo Sosa": "luis.escobedo@evoelution.com",
  "Oscar Martínez": "oscar.martinez@evoelution.com",
  "Aneth Mitchelle Maldonado": "aneth.maldonado@evoelution.com",
  "Victor Carvajal": "victor.carvajal@evoelution.com",
};

/** Laboratorio técnico para lo que no se pudo atribuir. No es un cliente real. */
const UNASSIGNED = "SIN ASIGNAR (revisar)";

/* ===================== importación ===================== */

type Issue = {
  archivo: string;
  registro: string;
  problema: string;
  detalle: string;
  accion: string;
};

async function main() {
  const args = process.argv.slice(2);
  const dir = args[args.indexOf("--dir") + 1];
  const dryRun = args.includes("--dry-run");
  const wipe = args.includes("--wipe");
  if (!dir || dir.startsWith("--")) {
    console.error("Uso: npx tsx scripts/import-legacy.ts --dir <carpeta> [--dry-run] [--wipe]");
    process.exit(1);
  }

  const read = (f: string) => parseCsv(readFileSync(path.join(dir, f), "utf8"));
  const sae = read("SAE90_customer.csv");
  const det = read("Detalles.csv");
  const con = read("Contratos (1).csv");
  const tic = read("Reportes de Servicio.csv");

  const issues: Issue[] = [];
  const note = (i: Issue) => issues.push(i);

  console.log(`\n▸ Leídos: ${sae.length} clientes SAE · ${det.length} equipos · ${con.length} contratos · ${tic.length} tickets`);

  /* ---------- 1. Padrón de clientes ---------- */
  const saeReal = sae.filter(
    (r) => r.NOMBRE && !r.NOMBRE.includes("*****") && r.NOMBRE.trim().length > 2,
  );
  const byNorm = new Map<string, Record<string, string>>();
  const dupNames = new Map<string, string[]>();
  for (const r of saeReal) {
    const k = normName(r.NOMBRE);
    byNorm.set(k, r);
    dupNames.set(k, [...(dupNames.get(k) ?? []), r.NOMBRE.trim()]);
  }
  // SAE trae la misma razón social varias veces (matriz/sucursal, o con y sin
  // "S.A. de C.V."). Se importan TODAS —el origen las distingue por RFC— pero
  // hay que avisar: si no, en el CRM aparecen clientes duplicados sin
  // explicación y alguien los borra a ciegas.
  for (const [, names] of dupNames) {
    if (names.length > 1) {
      note({
        archivo: "SAE90_customer.csv",
        registro: names[0],
        problema: "Cliente repetido en el padrón",
        detalle: names.join(" | "),
        accion:
          "Se importaron todos (el RFC los distingue). Fusionar en el CRM si son el mismo cliente.",
      });
    }
  }

  /* ---------- 2. Dueño de cada equipo ---------- */
  // Detalles.csv no dice de quién es cada equipo: se deduce cruzando contratos
  // y tickets. El CONTRATO gana sobre el ticket cuando se contradicen — es un
  // documento firmado, no una captura de campo.
  const detSeries = new Set(det.map((r) => r["Número de serie"].trim().toUpperCase()));
  const ownerByContract = new Map<string, string>();
  const ownerByTicket = new Map<string, string>();

  for (const r of con) {
    const cli = r["Cliente_"].trim();
    if (!cli) continue;
    const { ok } = splitSeries(r.Serie, detSeries);
    for (const s of ok) ownerByContract.set(s.toUpperCase(), cli);
  }
  for (const r of tic) {
    const s = (r.Nserie || "").trim().toUpperCase();
    const cli = (r.Cliente || "").trim();
    if (s && s !== "N/A" && cli) ownerByTicket.set(s, cli);
  }

  const ownerOf = new Map<string, string>();
  for (const s of detSeries) {
    const c = ownerByContract.get(s);
    const t = ownerByTicket.get(s);
    if (c && t && normName(c) !== normName(t)) {
      note({
        archivo: "Detalles.csv",
        registro: s,
        problema: "Dueño contradictorio",
        detalle: `contrato dice "${c}" · ticket dice "${t}"`,
        accion: `Se asignó al del contrato ("${c}"). Verificar si el equipo cambió de laboratorio.`,
      });
    }
    const owner = c ?? t;
    if (owner) ownerOf.set(s, owner);
    else {
      ownerOf.set(s, UNASSIGNED);
      note({
        archivo: "Detalles.csv",
        registro: s,
        problema: "Sin dueño deducible",
        detalle: "no aparece en ningún contrato ni ticket",
        accion: `Importado bajo "${UNASSIGNED}". Reasignar al laboratorio correcto.`,
      });
    }
  }

  /* ---------- 3. Qué laboratorios necesitan cuenta de portal ---------- */
  const needAccount = new Set<string>([UNASSIGNED]);
  for (const v of ownerOf.values()) needAccount.add(v);
  for (const r of tic) if (r.Cliente?.trim()) needAccount.add(r.Cliente.trim());
  for (const r of con) if (r["Cliente_"]?.trim()) needAccount.add(r["Cliente_"].trim());

  console.log(`▸ Laboratorios con actividad: ${needAccount.size}`);
  console.log(`▸ Equipos con dueño: ${[...ownerOf.values()].filter((v) => v !== UNASSIGNED).length}/${detSeries.size}`);

  if (dryRun) {
    console.log("\n▸ --dry-run: no se escribe nada.");
    writeReport(issues, dir);
    process.exit(0);
  }

  /* ---------- 4. Escritura ---------- */
  // Las tablas de negocio viven en el esquema del inquilino, no en `public`.
  // Sin --tenant no hay a dónde escribir, y eso es correcto: importar a la
  // empresa equivocada es peor que no importar.
  const slugArg = args[args.indexOf("--tenant") + 1];
  if (!slugArg || slugArg.startsWith("--")) {
    throw new Error("Falta --tenant <slug>: indicá a qué empresa se importa.");
  }
  const db = tenantDbFor(schemaNameFor(slugArg));
  const counts = {
    orgs: 0, labs: 0, techs: 0, equipos: 0, modulos: 0,
    contratos: 0, contratoEquipos: 0, tickets: 0, comentarios: 0, refacciones: 0,
  };

  await db.transaction(async (tx) => {
    const [{ n: existing }] = (await tx.execute(
      sql`select (select count(*) from tickets) + (select count(*) from equipment) as n`,
    )) as unknown as Array<{ n: number }>;

    if (Number(existing) > 0 && !wipe) {
      throw new Error(
        `La base ya tiene ${existing} registros. Usá --wipe para reemplazarlos, o importá a una base vacía.`,
      );
    }

    if (wipe) {
      console.log("\n▸ Limpiando datos previos (se conservan las cuentas de staff)…");
      // Orden dictado por las foreign keys. inventory_movements va primero
      // porque referencia spare_parts con onDelete: restrict.
      await tx.execute(sql`delete from inventory_movements`);
      await tx.execute(sql`delete from ticket_comment_parts`);
      await tx.execute(sql`delete from ticket_comments`);
      await tx.execute(sql`delete from tickets`);
      await tx.execute(sql`delete from contract_equipment`);
      await tx.execute(sql`delete from contracts`);
      await tx.execute(sql`delete from equipment_submodules`);
      await tx.execute(sql`delete from equipment_modules`);
      await tx.execute(sql`delete from equipment`);
      await tx.execute(sql`delete from crm_deal_labels`);
      await tx.execute(sql`delete from crm_deal_products`);
      await tx.execute(sql`delete from crm_deal_events`);
      await tx.execute(sql`delete from crm_activities`);
      await tx.execute(sql`delete from crm_notes`);
      await tx.execute(sql`delete from crm_deals`);
      await tx.execute(sql`delete from crm_contacts`);
      await tx.execute(sql`delete from crm_organizations`);
      await tx.execute(sql`delete from spare_parts`);
      // Solo las cuentas de laboratorio: admin/agente/ventas siguen entrando.
      await tx.execute(sql`delete from users where role = 'client'`);
    }

    const [company] = await tx.select({ id: companies.id }).from(companies).limit(1);
    const companyId = company?.id ?? null;

    // Autor de respaldo para las bitácoras sin técnico asignado: ticketComments
    // .authorId es NOT NULL, así que hace falta una cuenta real de staff.
    const [fallbackAuthor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`role in ('admin','agent')`)
      .limit(1);

    /**
     * Bitácora de la migración. Cada registro importado deja su fila CRUDA del
     * CSV en el payload: es lo que permite responder después "de dónde salió
     * este dato y qué decía el archivo original" sin volver a los archivos, que
     * para entonces pueden no existir.
     *
     * Se acumulan y se insertan por lotes al final: 1000 inserciones sueltas
     * dentro de la transacción son 1000 viajes de red y dominarían el tiempo.
     */
    const pending: Array<{
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }> = [];
    const traza = (
      aggregateType: string,
      aggregateId: string,
      eventType: string,
      raw: Record<string, string>,
    ) => pending.push({ aggregateType, aggregateId, eventType, payload: { origen: raw } });

    /* --- técnicos --- */
    const techId = new Map<string, string>();
    for (const [name, email] of Object.entries(TECH_EMAIL)) {
      const [u] = await tx
        .insert(users)
        .values({ name: name.replace(/\s+/g, " ").trim(), email, role: "agent" })
        .onConflictDoUpdate({ target: users.email, set: { role: "agent" } })
        .returning({ id: users.id });
      techId.set(name, u.id);
      counts.techs++;
      if (email !== "ruben.barrios@evoelution.com") {
        note({
          archivo: "Reportes de Servicio.csv",
          registro: name,
          problema: "Correo del técnico deducido",
          detalle: email,
          accion: "Verificar antes de invitarlo al portal. Sin contraseña no puede entrar.",
        });
      }
    }

    /* --- laboratorios: cuenta de portal + organización del CRM --- */
    const labId = new Map<string, string>();
    const orgId = new Map<string, string>();

    for (const name of needAccount) {
      const key = normName(name);
      const s = byNorm.get(key);
      // Sin correo real en el origen (SAE trae EMAILPRED, que es interno de
      // Evoelution). Se sintetiza uno marcado: la cuenta queda creada pero sin
      // contraseña, así que NO puede iniciar sesión hasta que la inviten.
      const email = `${slug(name) || "lab"}@import.evoelution.local`;
      const [u] = await tx
        .insert(users)
        .values({
          name,
          email,
          role: "client",
          company: name,
          phone: s?.TELEFONO?.trim() || null,
          active: name !== UNASSIGNED,
        })
        .onConflictDoUpdate({ target: users.email, set: { name } })
        .returning({ id: users.id });
      labId.set(key, u.id);
      counts.labs++;
      if (!s && name !== UNASSIGNED) {
        note({
          archivo: "Reportes de Servicio.csv / Contratos.csv",
          registro: name,
          problema: "Cliente sin match en el padrón SAE",
          detalle: "aparece en tickets o contratos pero no en SAE90_customer.csv",
          accion: "Se creó la organización igual. Verificar si falta darlo de alta en SAE.",
        });
      }
    }

    /* --- padrón completo de organizaciones --- */
    for (const r of saeReal) {
      const key = normName(r.NOMBRE);
      const direccion = [r.CALLE, r.NUMEXT, r.COLONIA, r.MUNICIPIO, r.ESTADO, r.CODIGO]
        .map((x) => (x || "").trim())
        .filter((x) => x && x !== "0")
        .join(", ");
      const [o] = await tx
        .insert(crmOrganizations)
        .values({
          name: r.NOMBRE.trim(),
          taxId: r.RFC?.trim() || null,
          phone: r.TELEFONO?.trim() || null,
          website: r.PAG_WEB?.trim() || null,
          address: direccion || null,
          clientId: labId.get(key) ?? null,
          companyId,
          notes: `Importado del padrón SAE${r.STATUS === "B" ? " (marcado como baja en SAE)" : ""}`,
        })
        .returning({ id: crmOrganizations.id });
      orgId.set(key, o.id);
      counts.orgs++;
      traza("organization", o.id, "organization.imported", r);
    }
    // Los que tienen actividad pero no están en SAE.
    for (const name of needAccount) {
      const key = normName(name);
      if (orgId.has(key) || name === UNASSIGNED) continue;
      const [o] = await tx
        .insert(crmOrganizations)
        .values({
          name,
          clientId: labId.get(key) ?? null,
          companyId,
          notes: "Con actividad en tickets/contratos, ausente del padrón SAE",
        })
        .returning({ id: crmOrganizations.id });
      orgId.set(key, o.id);
      counts.orgs++;
    }

    /* --- equipos: sistema + módulos --- */
    // Cada fila de Detalles es un MÓDULO con su serie. Se agrupan en un EQUIPO
    // (sistema) usando los contratos, que ya dicen qué series van juntas —
    // es como funciona un HPLC: una bomba, un detector, un horno.
    const detBySerie = new Map(det.map((r) => [r["Número de serie"].trim().toUpperCase(), r]));
    const systemOf = new Map<string, string>(); // serie → clave de sistema
    for (const r of con) {
      const { ok } = splitSeries(r.Serie, detSeries);
      if (ok.length < 2) continue;
      for (const s of ok) systemOf.set(s.toUpperCase(), `contrato:${r.Contrato}`);
    }

    const groups = new Map<string, string[]>();
    for (const s of detSeries) {
      const k = systemOf.get(s) ?? `individual:${s}`;
      const arr = groups.get(k) ?? [];
      arr.push(s);
      groups.set(k, arr);
    }

    const moduleId = new Map<string, string>();
    const equipmentOfSerie = new Map<string, string>();

    for (const [gkey, series] of groups) {
      const rows = series.map((s) => detBySerie.get(s)!).filter(Boolean);
      if (!rows.length) continue;
      const owner = ownerOf.get(series[0]) ?? UNASSIGNED;
      const ownerUser = labId.get(normName(owner)) ?? labId.get(normName(UNASSIGNED))!;
      const brands = rows.map((r) => r.Linea).filter((b) => b && b !== "N/A");
      const brand = brands[0] ?? "N/D";
      const contrato = gkey.startsWith("contrato:") ? gkey.slice(9) : null;

      // El agrupamiento por contrato es DETERMINISTA pero no siempre equivale a
      // una sola máquina: un contrato puede amparar el parque entero de un
      // laboratorio. Por eso los grupos grandes se llaman "parque" y no
      // "sistema" — nombrarlos mal haría creer que 27 módulos son un equipo.
      const name =
        rows.length === 1
          ? rows[0].Descripción || rows[0]["Módulo"] || "Equipo"
          : rows.length <= 6
            ? `Sistema ${brand} — contrato ${contrato} (${rows.length} módulos)`
            : `Parque ${brand} — contrato ${contrato} (${rows.length} módulos)`;

      if (rows.length > 6) {
        note({
          archivo: "Contratos (1).csv",
          registro: contrato ?? "(sin contrato)",
          problema: "Grupo grande: probablemente varios equipos",
          detalle: `${rows.length} módulos bajo un solo contrato (${brand})`,
          accion:
            "Importado como un solo 'parque'. Separarlo en equipos físicos desde la UI si hace falta; los módulos ya tienen su serie.",
        });
      }

      const [eq] = await tx
        .insert(equipment)
        .values({
          ownerId: ownerUser,
          brand,
          name: name.slice(0, 200),
          model: rows.length === 1 ? rows[0]["Módulo"] || null : null,
          notes: gkey.startsWith("contrato:")
            ? `Agrupado por el contrato ${gkey.slice(9)} (importado)`
            : "Importado del inventario anterior",
        })
        .returning({ id: equipment.id });
      counts.equipos++;

      for (const r of rows) {
        const serie = r["Número de serie"].trim();
        const [m] = await tx
          .insert(equipmentModules)
          .values({
            equipmentId: eq.id,
            brand: r.Linea && r.Linea !== "N/A" ? r.Linea : brand,
            name: (r["Módulo"] || r.Descripción || serie).slice(0, 200),
            serialNumber: serie,
          })
          .returning({ id: equipmentModules.id });
        moduleId.set(serie.toUpperCase(), m.id);
        equipmentOfSerie.set(serie.toUpperCase(), eq.id);
        counts.modulos++;
        traza("equipment", eq.id, "equipment.imported", r);
      }
    }

    /* --- contratos --- */
    for (const r of con) {
      const cli = r["Cliente_"].trim();
      if (!cli) {
        note({
          archivo: "Contratos (1).csv",
          registro: r.Contrato || "(sin número)",
          problema: "Contrato sin cliente",
          detalle: `serie=${r.Serie}`,
          accion: "NO importado. Completar el cliente y volver a cargar.",
        });
        continue;
      }
      const clientUser = labId.get(normName(cli));
      if (!clientUser) continue;

      // El origen guarda subtotal y total con IVA por separado, y la moneda se
      // deduce de cuál de las dos columnas de subtotal viene poblada.
      const subUsd = parseMoney(r.SubTotalUSD);
      const subMxn = parseMoney(r["Subtotal MXN"]);
      const currency = subUsd ? "USD" : subMxn ? "MXN" : null;

      const { ok: series, bad } = splitSeries(r.Serie, detSeries);
      for (const b of bad) {
        note({
          archivo: "Contratos (1).csv",
          registro: r.Contrato,
          problema: "Series no reconocidas",
          detalle: `"${b}" no casa con ninguna serie de Detalles.csv`,
          accion: "Contrato importado sin esos equipos. Vincularlos a mano.",
        });
      }

      const [c] = await tx
        .insert(contracts)
        .values({
          number: r.Contrato.slice(0, 60),
          clientId: clientUser,
          amountMxn: subMxn,
          amountUsd: subUsd,
          currency,
          startDate: isoDate(parseDate(r.Inicio)),
          endDate: isoDate(parseDate(r.Fin)),
          companyId,
          notes: [
            `Importado · tipo ${r["Tipo de contrato"] || "N/D"} · ${r.Vigencia || ""}`,
            r.Vendedor ? `Vendedor: ${r.Vendedor.replace(/\s+/g, " ").trim()}` : "",
            r.Total ? `Total con IVA en el origen: ${r.Total.trim()}` : "",
          ].filter(Boolean).join("\n"),
        })
        .onConflictDoNothing()
        .returning({ id: contracts.id });
      if (!c) continue;
      counts.contratos++;
      traza("contract", c.id, "contract.imported", r);

      const vistos = new Set<string>();
      for (const s of series) {
        const eqId = equipmentOfSerie.get(s.toUpperCase());
        if (!eqId || vistos.has(eqId)) continue;
        vistos.add(eqId);
        await tx.insert(contractEquipment)
          .values({ contractId: c.id, equipmentId: eqId })
          .onConflictDoNothing();
        counts.contratoEquipos++;
      }
    }

    /* --- tickets --- */
    // Re-foliados al formato de 6 dígitos; el folio original queda en
    // legacy_reference para que el reporte de papel siga siendo rastreable.
    const unassignedUser = labId.get(normName(UNASSIGNED))!;
    let maxFolio = 0;

    for (const r of tic) {
      const raw = (r.Ticket_evo || "").trim();
      const m = raw.match(/^EVO-(\d+)$/);
      if (!m) {
        note({
          archivo: "Reportes de Servicio.csv",
          registro: raw || "(vacío)",
          problema: "Folio ilegible",
          detalle: `problema="${(r.Problema || "").slice(0, 60)}"`,
          accion: "NO importado. Corregir el folio en el origen.",
        });
        continue;
      }
      const n = Number(m[1]);
      maxFolio = Math.max(maxFolio, n);

      const cli = (r.Cliente || "").trim();
      const clientUser = cli ? labId.get(normName(cli)) : undefined;
      if (!cli) {
        note({
          archivo: "Reportes de Servicio.csv",
          registro: raw,
          problema: "Ticket sin cliente",
          detalle: `problema="${(r.Problema || "").slice(0, 60)}"`,
          accion: `Importado bajo "${UNASSIGNED}". Reasignar al laboratorio.`,
        });
      }

      const serie = (r.Nserie || "").trim().toUpperCase();
      const modId = serie && serie !== "N/A" ? moduleId.get(serie) : undefined;
      const eqId = serie && serie !== "N/A" ? equipmentOfSerie.get(serie) : undefined;

      let clasif: string[] = [];
      try { clasif = JSON.parse(r["Clasificación"] || "[]"); } catch { clasif = []; }
      const category = CATEGORY[clasif[0]] ?? "other";
      const createdAt = parseDate(r["Fecha de reporte"]) ?? new Date();
      const status = STATUS[r.Estado] ?? "open";

      const [t] = await tx
        .insert(tickets)
        .values({
          reference: `EVO-${String(n).padStart(6, "0")}`,
          legacyReference: raw,
          subject: (r.Problema || "Sin descripción").slice(0, 240),
          description: r.Problema || "Importado del sistema anterior, sin descripción.",
          status,
          type: "service",
          priority: PRIORITY[r.Prioridad] ?? "medium",
          category,
          createdById: clientUser ?? unassignedUser,
          assignedToId: techId.get(r["Asignado a"]) ?? null,
          equipmentId: eqId ?? null,
          moduleId: modId ?? null,
          slaDueAt: parseDate(r["Fecha de vencimiento"]),
          resolvedAt: status === "closed" ? createdAt : null,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: tickets.id });
      if (!t) continue;
      counts.tickets++;
      traza("ticket", t.id, "ticket.imported", r);

      // Una entrada de bitácora por ticket, para no perder horas, refacciones
      // ni observaciones. Las horas alimentan el cálculo de rentabilidad.
      const horas = (r["Horas efectivas"] || "").replace(",", ".").trim();
      const partNums = [
        ...splitParts(r.Refacciones_solicitud),
        ...splitParts(r.Refacciones),
      ].filter((p) => p && !/^0+$/.test(p)); // descarta los "000000000" de relleno
      const obs = (r.Observaciones || "").trim();

      if (horas || partNums.length || obs) {
        const [cm] = await tx
          .insert(ticketComments)
          .values({
            ticketId: t.id,
            authorId: techId.get(r["Asignado a"]) ?? fallbackAuthor.id,
            body: obs || "Actividad importada del sistema anterior.",
            internal: true,
            equipmentId: eqId ?? null,
            moduleId: modId ?? null,
            hours: horas && !Number.isNaN(Number(horas)) ? Number(horas).toFixed(2) : null,
            createdAt,
          })
          .returning({ id: ticketComments.id });
        counts.comentarios++;

        // Refacciones históricas: se registran como consumo del ticket pero NO
        // generan movimiento de inventario. Ese consumo ya ocurrió y el stock
        // actual ya lo refleja; crear movimientos ahora lo contaría dos veces.
        for (const pn of new Set(partNums)) {
          await tx.insert(commentParts).values({
            commentId: cm.id,
            partId: null, // no están en el catálogo: no se inventa un alta
            partNumber: pn.slice(0, 80),
            description: "Refacción importada del histórico (sin ficha de catálogo)",
            quantity: 1,
          });
          counts.refacciones++;
        }
      }
    }

    /* --- bitácora de la migración, por lotes --- */
    for (let i = 0; i < pending.length; i += 500) {
      await tx.insert(domainEvents).values(
        pending.slice(i, i + 500).map((e) => ({
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          eventType: e.eventType,
          payload: e.payload,
          companyId,
        })),
      );
    }
    console.log(`▸ Bitácora: ${pending.length} eventos *.imported con la fila original`);

    // La secuencia arranca después del folio más alto importado, para que el
    // próximo ticket creado en la app no choque con uno migrado.
    await tx.execute(sql`select setval('ticket_reference_seq', ${maxFolio + 1}, false)`);
    console.log(`▸ Secuencia de folios en ${maxFolio + 1} (próximo: EVO-${String(maxFolio + 1).padStart(6, "0")})`);
  });

  console.log("\n▸ Importado:");
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(16)} ${v}`);
  writeReport(issues, dir);
}

function writeReport(issues: Issue[], dir: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv =
    "﻿" +
    ["archivo,registro,problema,detalle,accion"]
      .concat(issues.map((i) => [i.archivo, i.registro, i.problema, i.detalle, i.accion].map(esc).join(",")))
      .join("\r\n");
  const out = path.join(dir, "import-report.csv");
  writeFileSync(out, csv, "utf8");

  const byKind = issues.reduce<Record<string, number>>((a, i) => {
    a[i.problema] = (a[i.problema] ?? 0) + 1;
    return a;
  }, {});
  console.log(`\n▸ Incidencias (${issues.length}) → ${out}`);
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
}

main().catch((e) => {
  console.error("\n✗ La importación falló y se revirtió por completo:\n", e);
  process.exit(1);
});
