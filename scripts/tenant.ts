import "./_env"; // DEBE ir primero: ver scripts/_env.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { tenants, tenantSchemas, platformEvents, users, schemaNameFor } from "../src/lib/db/platform";
import {
  migrateAllTenants,
  migrateSchema,
  provisionTenant,
  dropTenantSchema,
} from "../src/lib/tenancy/provision";

/**
 * CLI de inquilinos.
 *
 *   npx tsx scripts/tenant.ts list
 *   npx tsx scripts/tenant.ts adopt --slug evoelution   ← una sola vez
 *   npx tsx scripts/tenant.ts provision --slug acme --name "ACME Labs"
 *   npx tsx scripts/tenant.ts migrate
 *   npx tsx scripts/tenant.ts drop --slug acme          ← solo desarrollo
 *   npx tsx scripts/tenant.ts grant --email a@b.com --role superadmin
 */

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/**
 * Las tablas de negocio, derivadas de las propias migraciones de inquilino.
 *
 * Se leen de ahí y no de una lista escrita a mano porque una lista se
 * desactualiza en silencio: alguien agrega una tabla, olvida el listado, y esa
 * tabla se queda en `public` compartida entre todos los inquilinos. El SQL de
 * migración es la única fuente que no puede quedar desfasada.
 */
function businessTables(): string[] {
  const dir = path.join(process.cwd(), "drizzle-tenant");
  const journal = JSON.parse(
    readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };

  const names = new Set<string>();
  for (const e of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sqlText = readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    for (const m of sqlText.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([a-z_]+)"/g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

/**
 * Mueve los datos que ya existen en `public` al esquema del primer inquilino.
 *
 * Usa `ALTER TABLE ... SET SCHEMA`, que reubica la tabla CON sus datos, índices,
 * restricciones y triggers, sin copiar una sola fila. Con 602 tickets da igual,
 * pero con millones sería la diferencia entre segundos y horas de ventana de
 * mantenimiento.
 *
 * Las secuencias se mueven también: si se quedaran en `public`, todos los
 * inquilinos compartirían el contador de folios.
 */
async function adopt(slug: string) {
  const db = getDb();
  const schemaName = schemaNameFor(slug);

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) throw new Error(`No existe el inquilino "${slug}".`);

  const tables = businessTables();
  const sequences = ["ticket_reference_seq", "crm_deal_reference_seq"];

  console.log(`▸ Adoptando ${tables.length} tablas y ${sequences.length} secuencias en ${schemaName}…`);

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));

    for (const t of tables) {
      const [{ existe }] = (await tx.execute(
        sql`select count(*)::int as existe from information_schema.tables
             where table_schema='public' and table_name=${t}`,
      )) as unknown as Array<{ existe: number }>;
      if (Number(existe) === 0) {
        console.log(`    ~ ${t}: no está en public, se omite`);
        continue;
      }
      await tx.execute(sql.raw(`ALTER TABLE "public"."${t}" SET SCHEMA "${schemaName}"`));
    }

    for (const s of sequences) {
      const [{ existe }] = (await tx.execute(
        sql`select count(*)::int as existe from information_schema.sequences
             where sequence_schema='public' and sequence_name=${s}`,
      )) as unknown as Array<{ existe: number }>;
      if (Number(existe) > 0) {
        await tx.execute(sql.raw(`ALTER SEQUENCE "public"."${s}" SET SCHEMA "${schemaName}"`));
      }
    }

    // Las tablas ya existen con su estructura: el baseline se marca aplicado en
    // vez de ejecutarse. Es el patrón de "línea base" de toda migración de
    // esquema existente.
    await tx
      .insert(tenantSchemas)
      .values({
        tenantId: tenant.id,
        schemaName,
        migratedVersion: "0000_old_gambit",
        migratedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantSchemas.tenantId,
        set: { schemaName, migratedVersion: "0000_old_gambit", migratedAt: new Date() },
      });

    await tx.insert(platformEvents).values({
      tenantId: tenant.id,
      eventType: "tenant.adopted",
      payload: { schemaName, tablas: tables.length, secuencias: sequences.length },
    });
  });

  // Lo posterior al baseline sí se aplica (p. ej. el trigger append-only).
  const applied = await migrateSchema(schemaName);
  console.log(`▸ Migraciones posteriores aplicadas: ${applied.join(", ") || "(ninguna)"}`);
}

async function list() {
  const db = getDb();
  const rows = await db
    .select({
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      ml: tenants.mlContribution,
      schemaName: tenantSchemas.schemaName,
      version: tenantSchemas.migratedVersion,
    })
    .from(tenants)
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id));

  console.log("\n  slug            estado     ML   esquema                versión");
  console.log("  " + "─".repeat(74));
  for (const r of rows) {
    console.log(
      `  ${(r.slug ?? "").padEnd(15)} ${(r.status ?? "").padEnd(10)} ${r.ml ? "sí " : "no "} ` +
        `${(r.schemaName ?? "— sin esquema —").padEnd(22)} ${r.version ?? "—"}`,
    );
  }
  console.log();
}

async function main() {
  switch (cmd) {
    case "list":
      await list();
      break;

    case "adopt": {
      const slug = flag("slug");
      if (!slug) throw new Error("Falta --slug");
      await adopt(slug);
      await list();
      break;
    }

    case "provision": {
      const slug = flag("slug");
      const name = flag("name");
      if (!slug || !name) throw new Error("Faltan --slug y/o --name");
      const r = await provisionTenant({ slug, name, ownerUserId: flag("owner") });
      console.log(`▸ Inquilino "${r.slug}" creado en ${r.schemaName}`);
      console.log(`  migraciones: ${r.applied.join(", ")}`);
      await list();
      break;
    }

    case "migrate": {
      const result = await migrateAllTenants();
      for (const [schema, applied] of Object.entries(result)) {
        console.log(`  ${schema}: ${applied.length ? applied.join(", ") : "al día"}`);
      }
      break;
    }

    case "grant": {
      // Quién opera la plataforma es una decisión operativa, no un hecho del
      // esquema: por eso se otorga con un comando y queda en la bitácora, en
      // vez de venir horneado en una migración.
      const email = flag("email");
      const role = (flag("role") ?? "superadmin") as "superadmin" | "support";
      if (!email) throw new Error("Falta --email");
      if (role !== "superadmin" && role !== "support") {
        throw new Error('--role debe ser "superadmin" o "support"');
      }
      const db = getDb();
      const [u] = await db
        .update(users)
        .set({ platformRole: role })
        .where(eq(users.email, email.toLowerCase().trim()))
        .returning({ id: users.id, email: users.email });
      if (!u) throw new Error(`No existe el usuario ${email}`);
      await db.insert(platformEvents).values({
        eventType: "platform.role_granted",
        actorId: u.id,
        payload: { email: u.email, rol: role },
      });
      console.log(`▸ ${u.email} ahora es ${role} de la plataforma.`);
      break;
    }

    case "drop": {
      const slug = flag("slug");
      if (!slug) throw new Error("Falta --slug");
      await dropTenantSchema(slug);
      console.log(`▸ Esquema de "${slug}" eliminado.`);
      break;
    }

    default:
      console.log(
        "Comandos:\n" +
        "  list\n" +
        '  provision --slug X --name "Nombre" [--owner UUID]\n' +
        "  adopt --slug X\n" +
        "  migrate\n" +
        "  grant --email a@b.com [--role superadmin|support]\n" +
        "  drop --slug X   (solo desarrollo)",
      );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
