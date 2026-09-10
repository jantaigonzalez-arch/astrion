// Sin "server-only" a propósito: este módulo también se ejecuta desde
// scripts/tenant.ts, fuera del runtime de Next, donde ese alias no existe.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  memberships,
  platformEvents,
  tenants,
  tenantSchemas,
  RESERVED_SLUGS,
  schemaNameFor,
  suggestFolioPrefix,
} from "@/lib/db/platform";

/**
 * Aprovisionamiento y migración de esquemas por inquilino.
 *
 * Es la pieza que drizzle-kit no hace: aplicar el MISMO SQL a N esquemas.
 * El truco es que las tablas de negocio se declaran sin calificar el esquema,
 * así que basta fijar `search_path` antes de ejecutar.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle-tenant");

type JournalEntry = { idx: number; tag: string; when: number };

function readJournal(): JournalEntry[] {
  const raw = readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

/**
 * Tablas del plano de control. Una llave foránea hacia ellas SÍ debe quedar
 * calificada a `public`: existen una sola vez para toda la plataforma.
 */
const PLATFORM_TABLES = new Set([
  "users",
  "tenants",
  "tenant_schemas",
  "memberships",
  "companies",
  "platform_events",
]);

/**
 * Adapta el SQL generado por drizzle para aplicarlo a un esquema de inquilino.
 *
 * drizzle asume un solo esquema y califica todo a `public`. Hay tres cosas que
 * corregir, y equivocarse en cualquiera produce un fallo silencioso:
 *
 * 1. SECUENCIAS → al esquema del inquilino.
 *    Dejarlas en `public` haría que los folios de TODOS los inquilinos salieran
 *    del mismo contador: cada cliente vería saltos inexplicables en su
 *    numeración y, peor, quedaría expuesto el volumen de operación de los
 *    demás. Es el error más caro de los tres porque no rompe nada al momento.
 *
 * 2. LLAVES FORÁNEAS entre tablas de negocio → sin calificar.
 *    `REFERENCES "public"."ticket_comments"` apuntaría a una tabla que ya no
 *    está ahí. Sin calificar, resuelve por `search_path` al esquema del
 *    inquilino. Las que apuntan a `users` o `companies` sí conservan `public`:
 *    son del plano de control y viven una sola vez.
 *
 * 3. TIPOS ENUM → compartidos en `public`, creados una sola vez.
 *    Un enum es una definición, no datos. Una copia por inquilino multiplicaría
 *    el trabajo de cada cambio sin ganar nada, así que se dejan en `public` y
 *    se envuelven para que el segundo inquilino no falle al encontrarlos hechos.
 */
export function prepareStatements(rawSql: string): string[] {
  return rawSql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\/\*[\s\S]*\*\/$/.test(s))
    .map((stmt) => {
      // (1) Las secuencias van al esquema del inquilino.
      let out = stmt.replace(/CREATE SEQUENCE "public"\."/g, 'CREATE SEQUENCE "');

      // (2) FK entre tablas de negocio: quitar la calificación.
      out = out.replace(
        /REFERENCES "public"\."([a-z_]+)"/g,
        (match, table: string) =>
          PLATFORM_TABLES.has(table) ? match : `REFERENCES "${table}"`,
      );

      /*
        (3) Los tipos se comparten; el segundo inquilino los encuentra hechos.

        ── POR QUÉ SE MIRA DESPUÉS DE LOS COMENTARIOS ──────────────────────

        La comprobación era `/^CREATE TYPE /` sobre el texto entero, y eso
        dependía de que la sentencia empezara EXACTAMENTE por ahí. Una migración
        escrita a mano con su cabecera de comentarios —que es como se escriben
        todas en esta casa— hace que el texto empiece por `--`, la envoltura no
        se aplica, y el resultado es un fallo que no se parece a la causa: el
        PRIMER inquilino migra bien y el segundo muere con «type already
        exists», porque para él el tipo ya lo creó el primero.

        Pasó al escribir la 0034, y el síntoma era desconcertante: `evoelution`
        con las tablas nuevas y `acme` y `bajio` clavados en la 0033, sin un
        error a la vista porque el script de siembra no lo propagaba.

        Se ignoran los comentarios de línea del principio, que es lo único que
        puede haber antes de la sentencia de verdad.
      */
      const sinCabecera = out.replace(/^(?:\s*--[^\n]*\n)+/, "").trimStart();
      if (/^CREATE TYPE /i.test(sinCabecera)) {
        const body = sinCabecera.replace(/;\s*$/, "");
        out = `DO $do$ BEGIN ${body}; EXCEPTION WHEN duplicate_object THEN NULL; END $do$`;
      }
      return out;
    });
}

/** Cita un identificador para interpolarlo: no se puede parametrizar un esquema. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Identificador de esquema inválido: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * Aplica las migraciones pendientes a UN esquema.
 *
 * Cada migración corre en su propia transacción: si la tercera falla, las dos
 * primeras quedan aplicadas y registradas, y el reintento continúa desde ahí.
 * Es preferible a envolver todo en una sola transacción, porque con N esquemas
 * un fallo al final dejaría a los anteriores sin nada aplicado.
 */
export async function migrateSchema(schemaName: string): Promise<string[]> {
  const db = getDb();
  const journal = readJournal();

  const [row] = await db
    .select({ version: tenantSchemas.migratedVersion })
    .from(tenantSchemas)
    .where(eq(tenantSchemas.schemaName, schemaName))
    .limit(1);

  const current = row?.version ?? null;
  const startIdx = current ? journal.findIndex((e) => e.tag === current) + 1 : 0;
  const pending = journal.slice(startIdx);
  const applied: string[] = [];

  for (const entry of pending) {
    const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const statements = prepareStatements(readFileSync(file, "utf8"));

    await db.transaction(async (tx) => {
      // SET LOCAL: vive solo lo que dura la transacción. Con un pool de
      // conexiones, un SET normal se filtraría a la siguiente petición, que
      // podría ser de otro inquilino.
      await tx.execute(sql.raw(`SET LOCAL search_path TO ${ident(schemaName)}, public`));
      for (const stmt of statements) await tx.execute(sql.raw(stmt));

      await tx
        .update(tenantSchemas)
        .set({ migratedVersion: entry.tag, migratedAt: new Date() })
        .where(eq(tenantSchemas.schemaName, schemaName));
    });

    applied.push(entry.tag);
  }

  return applied;
}

/** Aplica lo pendiente a TODOS los inquilinos. Devuelve qué se aplicó a cada uno. */
export async function migrateAllTenants(): Promise<Record<string, string[]>> {
  const db = getDb();
  const rows = await db
    .select({ schemaName: tenantSchemas.schemaName })
    .from(tenantSchemas);

  const result: Record<string, string[]> = {};
  for (const r of rows) result[r.schemaName] = await migrateSchema(r.schemaName);
  return result;
}

export type ProvisionInput = {
  slug: string;
  name: string;
  /** Se le crea membresía de `owner`: quien puede facturar y dar consentimiento de datos. */
  ownerUserId?: string;
  plan?: string;
  /** Prefijo de folio. Si se omite, se deriva del nombre. */
  folioPrefix?: string;
};

/**
 * Da de alta un inquilino: crea su esquema, lo migra y lo registra.
 *
 * El esquema se crea FUERA de la transacción del registro a propósito. Un
 * `CREATE SCHEMA` seguido de decenas de `CREATE TABLE` dentro de la misma
 * transacción que el alta mantendría bloqueos sobre el catálogo de Postgres
 * mucho tiempo, y eso afecta a todos los inquilinos, no solo al nuevo.
 */
export async function provisionTenant(input: ProvisionInput) {
  const db = getDb();
  const slug = input.slug.trim().toLowerCase();

  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`El identificador "${slug}" está reservado por la plataforma.`);
  }
  const schemaName = schemaNameFor(slug); // valida el formato

  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  /*
    Existir la FILA no es lo mismo que estar aprovisionado.

    En una instalación nueva, la migración 0016 siembra el inquilino
    `evoelution` y su `company` —para que un despliegue que venía de la época de
    una sola empresa siga funcionando—, pero no crea ningún esquema: eso lo hace
    este archivo. El resultado era que la primera empresa de un servidor recién
    montado NO se podía dar de alta: `provision` abortaba con "ya existe" y no
    quedaba ningún camino hacia adelante.

    Y el que parecía la salida es peor: `tenant.ts adopt` MUEVE las tablas de
    negocio desde `public` y marca la línea base como aplicada sin ejecutarla.
    Sobre una base nueva, donde esas tablas nunca estuvieron en `public`, deja
    un esquema VACÍO que el sistema cree migrado — y eso no da un error, da una
    empresa que falla al primer ticket.

    Así que se distingue por el esquema, que es lo que de verdad importa: si el
    inquilino ya tiene uno registrado, sigue siendo un duplicado y se rechaza;
    si no lo tiene, esta llamada es justo lo que le faltaba y se completa.
  */
  let filaSembrada: { id: string } | null = null;
  if (existing) {
    const [conEsquema] = await db
      .select({ schemaName: tenantSchemas.schemaName })
      .from(tenantSchemas)
      .where(eq(tenantSchemas.tenantId, existing.id))
      .limit(1);
    if (conEsquema) {
      throw new Error(`Ya existe un inquilino con el identificador "${slug}".`);
    }
    filaSembrada = existing;
  }

  // 1. Registro del inquilino y su esquema.
  const tenant = filaSembrada
    ? await db.transaction(async (tx) => {
        // El nombre y el prefijo de folio de la fila sembrada son marcadores de
        // posición: mandan los que se pasan aquí, que son los que eligió quien
        // da de alta la empresa. El prefijo sobre todo — se congela en el
        // primer folio emitido y después ya no se corrige.
        const [t] = await tx
          .update(tenants)
          .set({
            name: input.name.trim(),
            folioPrefix: input.folioPrefix ?? suggestFolioPrefix(input.name),
          })
          .where(eq(tenants.id, filaSembrada!.id))
          .returning({ id: tenants.id, slug: tenants.slug });

        await tx.insert(tenantSchemas).values({ tenantId: t.id, schemaName });

        if (input.ownerUserId) {
          await tx.insert(memberships).values({
            userId: input.ownerUserId,
            tenantId: t.id,
            role: "owner",
            acceptedAt: new Date(),
          });
        }
        return t;
      })
    : await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({
        slug,
        name: input.name.trim(),
        plan: input.plan ?? "poc",
        status: "trial",
        // Se fija al crear y no al emitir el primer folio: un inquilino sin
        // prefijo emitiría `null-000001`, y ese folio ya no se corrige.
        folioPrefix: input.folioPrefix ?? suggestFolioPrefix(input.name),
      })
      .returning({ id: tenants.id, slug: tenants.slug });

    await tx.insert(tenantSchemas).values({ tenantId: t.id, schemaName });

    if (input.ownerUserId) {
      await tx.insert(memberships).values({
        userId: input.ownerUserId,
        tenantId: t.id,
        role: "owner",
        acceptedAt: new Date(),
      });
    }
    return t;
  });

  // 2. El esquema físico y sus tablas.
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${ident(schemaName)}`));
  const applied = await migrateSchema(schemaName);

  await db.insert(platformEvents).values({
    tenantId: tenant.id,
    eventType: "tenant.provisioned",
    payload: { slug, schemaName, migraciones: applied },
  });

  return { tenantId: tenant.id, slug, schemaName, applied };
}

/**
 * Elimina el esquema de un inquilino. DESTRUCTIVO e irreversible.
 *
 * Solo para bases de desarrollo y pruebas. Dar de baja a un cliente real es
 * marcarlo `cancelled` y conservar su esquema hasta cumplir la retención
 * pactada: un ERP guarda documentos fiscales con plazos legales de años.
 */
export async function dropTenantSchema(slug: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dropTenantSchema no puede ejecutarse en producción.");
  }
  const db = getDb();
  const schemaName = schemaNameFor(slug);
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${ident(schemaName)} CASCADE`));
  if (t) {
    await db.delete(tenantSchemas).where(eq(tenantSchemas.tenantId, t.id));
    await db.delete(tenants).where(eq(tenants.id, t.id));
  }
}
