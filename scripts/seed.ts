/**
 * Seed de datos demo. Ejecuta:  npm run db:seed
 * Requiere DATABASE_URL en .env.local y las migraciones aplicadas (npm run db:push).
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import * as schema from "../src/lib/db/schema";
import {
  generateReference,
  slaDueFrom,
} from "../src/lib/tickets";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en .env.local");

  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  console.log("→ Usuarios…");
  const [admin] = await db
    .insert(schema.users)
    .values({
      name: "Admin Evoelution",
      email: "admin@evoelution.com",
      passwordHash: hash("Admin123!"),
      role: "admin",
    })
    .onConflictDoNothing()
    .returning();

  const [agent] = await db
    .insert(schema.users)
    .values({
      name: "Agente Soporte",
      email: "agente@evoelution.com",
      passwordHash: hash("Agente123!"),
      role: "agent",
    })
    .onConflictDoNothing()
    .returning();

  const [client1] = await db
    .insert(schema.users)
    .values({
      name: "Laboratorio Genérico",
      email: "cliente@lab.com",
      passwordHash: hash("Cliente123!"),
      role: "client",
      company: "Lab Genérico SA de CV",
      phone: "+52 55 1234 5678",
    })
    .onConflictDoNothing()
    .returning();

  if (client1) {
    console.log("→ Tickets demo…");
    const now = new Date();
    await db.insert(schema.tickets).values([
      {
        reference: generateReference(1),
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
        reference: generateReference(2),
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
