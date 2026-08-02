"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import { ACTIVE_TENANT_COOKIE, logTenantAccess } from "@/lib/tenancy/context";
import { provisionTenant } from "@/lib/tenancy/provision";

/**
 * Acciones de la consola de plataforma.
 *
 * Todas exigen `platformRole`. Es una dimensión distinta del rol dentro de una
 * empresa: el dueño de una cuenta manda en la suya y no debe ver ninguna otra.
 */

async function requirePlatform(level: "superadmin" | "any" = "any") {
  const session = await auth();
  const role = session?.user?.platformRole;
  if (!role) return null;
  if (level === "superadmin" && role !== "superadmin") return null;
  return session!;
}

export type PlatformState = {
  ok: boolean;
  error?: string;
  message?: string;
};

/**
 * Entra a la empresa de un cliente desde la consola.
 *
 * El acceso SIEMPRE queda registrado, y no como cortesía: un laboratorio
 * farmacéutico va a preguntar quién de tu equipo vio sus datos y cuándo. La
 * respuesta no puede depender de que alguien se acuerde.
 */
export async function enterTenant(formData: FormData): Promise<void> {
  const session = await requirePlatform();
  if (!session) return;

  const slug = String(formData.get("slug") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!slug) return;

  const db = getDb();
  const [t] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!t) return;

  await logTenantAccess({
    tenantId: t.id,
    actorId: session.user.id,
    slug: t.slug,
    reason,
  });

  const jar = await cookies();
  jar.set(ACTIVE_TENANT_COOKIE, t.slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Sesión, no persistente: entrar a la empresa de un cliente debe ser un
    // acto deliberado cada vez, no un estado que sobrevive semanas en el
    // navegador y hace olvidar dónde se está parado.
    maxAge: undefined,
  });

  revalidatePath("/", "layout");
}

/** Vuelve a la propia empresa (o a ninguna). */
export async function exitTenant(): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const jar = await cookies();
  jar.delete(ACTIVE_TENANT_COOKIE);
  revalidatePath("/", "layout");
}

/** Alta de empresa: crea su esquema, lo migra y lo deja listo. */
export async function createTenant(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const session = await requirePlatform("superadmin");
  if (!session) return { ok: false, error: "Solo un superadministrador da de alta empresas." };

  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!slug || !name) return { ok: false, error: "Faltan el identificador o el nombre." };

  try {
    const r = await provisionTenant({ slug, name, ownerUserId: session.user.id });
    revalidatePath("/platform");
    return {
      ok: true,
      message: `Empresa "${name}" creada en el esquema ${r.schemaName}, con ${r.applied.length} migración(es) aplicada(s).`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/**
 * Otorga o revoca el aporte de datos a modelos globales.
 *
 * Deliberadamente aquí y no en los ajustes de la empresa: es una decisión con
 * consecuencias legales, y se registra con responsable y fecha para poder
 * demostrarla en una auditoría.
 */
export async function setMlContribution(formData: FormData): Promise<void> {
  const session = await requirePlatform("superadmin");
  if (!session) return;

  const slug = String(formData.get("slug") ?? "").trim();
  const grant = formData.get("grant") === "1";
  if (!slug) return;

  const db = getDb();
  await db
    .update(tenants)
    .set({
      mlContribution: grant,
      mlConsentAt: grant ? new Date() : null,
      mlConsentBy: grant ? session.user.id : null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.slug, slug));

  revalidatePath("/platform");
}
