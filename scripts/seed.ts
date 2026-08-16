/**
 * Seed de datos demo. Ejecuta:  npm run db:seed
 * Requiere DATABASE_URL en .env.local y las migraciones aplicadas (npm run db:push).
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/lib/db/schema";
import * as platform from "../src/lib/db/platform";
import {
  slaDueFrom,
} from "../src/lib/tickets";

config({ path: ".env.local" });

/**
 * Folio de los tickets de demostración.
 *
 * Local al script a propósito: los folios reales los emite
 * `nextTicketReference`, que toma el prefijo de la empresa. Esta siembra es
 * para Evoelution, así que su prefijo va fijo aquí y no se le presta al resto
 * de la aplicación.
 */
function demoReference(n: number): string {
  return `EVO-${String(n).padStart(6, "0")}`;
}

/** Empresa a la que pertenece la siembra. */
const TENANT_SLUG = process.env.SEED_TENANT ?? "evoelution";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en .env.local");

  // El plano de control (users, tenants, memberships) vive en `public`; las
  // tablas de negocio, en el esquema de la empresa. Son dos conexiones porque
  // son dos ámbitos: sembrar tickets "en public" ya no escribe en ningún lado.
  const controlClient = postgres(url, { prepare: false });
  const control = drizzle(controlClient, { schema: platform });

  const [tenant] = await control
    .select({
      id: platform.tenants.id,
      schemaName: platform.tenantSchemas.schemaName,
    })
    .from(platform.tenants)
    .leftJoin(
      platform.tenantSchemas,
      eq(platform.tenantSchemas.tenantId, platform.tenants.id),
    )
    .where(eq(platform.tenants.slug, TENANT_SLUG))
    .limit(1);

  if (!tenant?.schemaName) {
    throw new Error(
      `No existe el inquilino "${TENANT_SLUG}" o no tiene esquema. ` +
        `Créalo antes:  npx tsx scripts/tenant.ts create --slug ${TENANT_SLUG}`,
    );
  }

  const client = postgres(url, {
    prepare: false,
    connection: { search_path: `${tenant.schemaName}, public` },
  });
  const db = drizzle(client, { schema });

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  /**
   * Alta de una persona: identidad global + su papel EN ESTA empresa.
   *
   * Son dos escrituras porque son dos cosas. Antes esto insertaba en `users`
   * con un `role` y se daba por hecho: la cuenta quedaba sin membresía, así que
   * al iniciar sesión no pertenecía a ninguna empresa y no veía nada.
   */
  async function seedPerson(values: {
    name: string;
    email: string;
    password: string;
    role: platform.MembershipRole;
    company?: string;
    phone?: string;
  }) {
    const [user] = await control
      .insert(platform.users)
      .values({
        name: values.name,
        email: values.email,
        passwordHash: hash(values.password),
        company: values.company,
        phone: values.phone,
      })
      .onConflictDoUpdate({
        target: platform.users.email,
        set: { name: values.name },
      })
      .returning();

    await control
      .insert(platform.memberships)
      .values({
        userId: user.id,
        tenantId: tenant.id,
        role: values.role,
        active: true,
        acceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [platform.memberships.userId, platform.memberships.tenantId],
        set: { role: values.role, active: true },
      });

    return user;
  }

  console.log(`→ Usuarios de ${TENANT_SLUG}…`);
  const admin = await seedPerson({
    name: "Admin Evoelution",
    email: "admin@evoelution.com",
    password: "Admin123!",
    role: "admin",
  });

  const agent = await seedPerson({
    name: "Agente Soporte",
    email: "agente@evoelution.com",
    password: "Agente123!",
    role: "agent",
  });

  const client1 = await seedPerson({
    name: "Laboratorio Genérico",
    email: "cliente@lab.com",
    password: "Cliente123!",
    role: "client",
    company: "Lab Genérico SA de CV",
    phone: "+52 55 1234 5678",
  });

  if (client1) {
    console.log("→ Tickets demo…");
    const now = new Date();
    await db.insert(schema.tickets).values([
      {
        reference: demoReference(1),
        subject: "Falla intermitente en bomba HPLC Waters 1525",
        description:
          "La bomba presenta caídas de presión aleatorias durante corridas largas. Sospechamos aire en la línea B.",
        status: "open",
        priority: "high",
        category: "maintenance",
        createdById: client1.id,
        assignedToId: agent?.id ?? null,
        slaDueAt: slaDueFrom(now),
      },
      {
        reference: demoReference(2),
        subject: "Solicitud de validación IQ/OQ para UHPLC nuevo",
        description:
          "Requerimos calendario y cotización para validación de sistema computarizado del nuevo equipo.",
        status: "in_progress",
        priority: "medium",
        category: "validation",
        createdById: client1.id,
        assignedToId: agent?.id ?? null,
        slaDueAt: slaDueFrom(now),
      },
    ]);
  }

  console.log("→ Leads demo…");
  await db.insert(schema.leads).values([
    {
      name: "María López",
      email: "maria@farmaco.mx",
      company: "Farmacéutica del Valle",
      message: "Nos interesa capacitación en GC-MS para 4 analistas.",
      status: "new",
      score: 78,
    },
  ]);

  console.log("✓ Seed completo.");
  console.log("   admin@evoelution.com / Admin123!");
  console.log("   agente@evoelution.com / Agente123!");
  console.log("   cliente@lab.com / Cliente123!");
  await client.end();
  await controlClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
