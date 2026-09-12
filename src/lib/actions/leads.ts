"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { tenantDbFor } from "@/lib/tenancy/context";
import { leads } from "@/lib/db/schema";
import { tenantSchemas, tenants } from "@/lib/db/platform";

/**
 * A QUÉ EMPRESA LE LLEGAN LOS CONTACTOS DEL SITIO PÚBLICO.
 *
 * Guardaba con `tenantDb()`, que saca la empresa de la SESIÓN. Quien llena el
 * formulario de /contacto es un visitante sin sesión, así que `requireTenant()`
 * lanzaba, el `catch` respondía «server» y el contacto se perdía —desde que el
 * producto pasó a multiempresa (0adf722)—; y a quien sí tenía sesión, el
 * contacto le caía en el CRM de su propia empresa. Lo encontró
 * `_probe-acciones-publicas`.
 *
 * El sitio público es de UNA empresa, así que el destino es fijo: el de
 * `LEADS_TENANT` (su slug), y por omisión `evoelution`.
 */
async function esquemaDeLosContactos(): Promise<string | null> {
  const slug = process.env.LEADS_TENANT || "evoelution";
  const [t] = await getDb()
    .select({ schemaName: tenantSchemas.schemaName })
    .from(tenants)
    .innerJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(eq(tenants.slug, slug))
    .limit(1);
  return t?.schemaName ?? null;
}

const LeadSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().max(255),
  company: z.string().max(200).optional(),
  message: z.string().min(5).max(2000),
});

export type LeadFormState = {
  ok: boolean;
  error?: string;
};

export async function submitLead(
  _prev: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const parsed = LeadSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company") || undefined,
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  // Sin DB: aceptamos el lead (degradación elegante) hasta configurar Postgres.
  if (!isDbConfigured) {
    console.info("[lead] recibido (sin DB):", parsed.data.email);
    return { ok: true };
  }

  try {
    const esquema = await esquemaDeLosContactos();
    if (!esquema) {
      console.error("[lead] LEADS_TENANT no nombra ninguna empresa aprovisionada");
      return { ok: false, error: "server" };
    }
    await tenantDbFor(esquema).insert(leads).values({
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      company: parsed.data.company,
      message: parsed.data.message,
      source: "web_contact",
    });
    return { ok: true };
  } catch (e) {
    console.error("[lead] error al persistir:", e);
    return { ok: false, error: "server" };
  }
}
