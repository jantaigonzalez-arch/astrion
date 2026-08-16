"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import {
  platformEvents,
  tenants,
  tenantSignups,
  users,
  RESERVED_SLUGS,
  schemaNameFor,
} from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import { ACTIVE_TENANT_COOKIE, logTenantAccess } from "@/lib/tenancy/context";
import { apexOrigin, portOf, tenantOrigin } from "@/lib/tenancy/host";
import { provisionTenant } from "@/lib/tenancy/provision";

/**
 * Acciones de la consola de plataforma.
 *
 * Todas exigen `platformRole`. Es una dimensión distinta del rol dentro de una
 * empresa: el dueño de una cuenta manda en la suya y no debe ver ninguna otra.
 */

/**
 * Ruta con prefijo de idioma.
 *
 * Las acciones no reciben el locale de la petición, así que viaja como campo
 * oculto del formulario. El prefijo es `as-needed`: el español, que es el
 * idioma por omisión, no lleva ninguno.
 */
function pathFor(locale: string, path: string): string {
  return locale === "en" ? `/en${path}` : path;
}

/**
 * Esquema para los saltos entre dominios.
 *
 * En desarrollo `*.localhost` se sirve por http y forzar https daría un salto
 * a un puerto que no escucha nadie. En producción siempre https: nginx redirige
 * :80 a :443, pero emitir la redirección ya en claro es un viaje de más y una
 * ventana para que alguien la intercepte.
 */
function secureProto(): "http" | "https" {
  return process.env.NODE_ENV === "production" ? "https" : "http";
}

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
  const locale = String(formData.get("locale") ?? "es");
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
  // Entrar significa ESTAR dentro: el operador queda en la app de esa empresa,
  // no en la consola mirando una tarjeta.
  //
  // Con dominio raíz configurado el destino es OTRO HOST, así que la
  // redirección tiene que ser absoluta. Es el único salto de la aplicación que
  // cruza de dominio, y funciona porque la cookie de sesión se emite para
  // `.astraion.com`; ver COOKIE_DOMAIN en lib/auth.ts.
  const port = portOf((await headers()).get("host"));
  const origin = tenantOrigin(t.slug, secureProto(), port);
  redirect(
    origin
      ? `${origin}${pathFor(locale, "/dashboard")}`
      : pathFor(locale, `/${t.slug}/dashboard`),
  );
}

/**
 * Sale del inquilino y vuelve a la consola de Astraion.
 *
 * Es la contraparte de `enterTenant` y hasta ahora no la llamaba nadie: se
 * podía entrar a la empresa de un cliente y no había forma de salir salvo
 * borrar la cookie a mano.
 */
export async function exitTenant(formData?: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const locale = String(formData?.get("locale") ?? "es");
  const jar = await cookies();
  jar.delete(ACTIVE_TENANT_COOKIE);
  revalidatePath("/", "layout");

  // Salir es volver al apex. Desde un subdominio, un path relativo dejaría al
  // operador en `evoelution.astraion.com/platform`: la consola de Astraion
  // servida bajo el dominio de un cliente, que es exactamente la confusión que
  // separar los dominios vino a evitar.
  const apex = apexOrigin(secureProto(), portOf((await headers()).get("host")));
  redirect(apex ? `${apex}${pathFor(locale, "/platform")}` : pathFor(locale, "/platform"));
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

/* ------------------------- Revisión de solicitudes ------------------------- */

export type ReviewState = {
  ok: boolean;
  error?: string;
  message?: string;
  /**
   * Credenciales del dueño, devueltas UNA sola vez y solo al aprobar.
   * No se guardan en claro en ningún lado: si el operador cierra la pantalla
   * sin copiarlas, el camino es restablecer la contraseña, no recuperarla.
   * Cuando haya envío de correo esto desaparece de la UI.
   */
  credentials?: { email: string; password: string; nuevo: boolean };
};

/**
 * Contraseña temporal legible por teléfono.
 *
 * Sin I/l/1/O/0: estas credenciales hoy se dictan a mano al cliente, y un
 * carácter ambiguo se convierte en un "no me deja entrar" que cuesta más que
 * los bits de entropía que se ceden. Con 12 caracteres de este alfabeto quedan
 * ~62 bits, de sobra para algo que se cambia en el primer acceso.
 */
function tempPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/**
 * Aprueba una solicitud: la convierte en inquilino con su esquema y su dueño.
 *
 * El identificador se toma del formulario y no de lo que pidió el solicitante,
 * porque el que propuso la web es una sugerencia derivada del nombre y aquí se
 * vuelve el nombre de un esquema de Postgres — cambiarlo después implica mover
 * tablas con conexiones vivas.
 */
export async function approveSignup(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePlatform("superadmin");
  if (!session) return { ok: false, error: "Solo un superadministrador aprueba altas." };

  const id = String(formData.get("id") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const plan = String(formData.get("plan") ?? "poc").trim() || "poc";
  if (!id || !slug) return { ok: false, error: "Falta la solicitud o el identificador." };

  const db = getDb();

  const [s] = await db
    .select()
    .from(tenantSignups)
    .where(eq(tenantSignups.id, id))
    .limit(1);
  if (!s) return { ok: false, error: "La solicitud ya no existe." };
  if (s.status !== "pending") {
    return { ok: false, error: `Esta solicitud ya está ${s.status === "approved" ? "aprobada" : "rechazada"}.` };
  }

  // TODA la validación del identificador va antes de tocar nada.
  //
  // No es cosmético: el correo es único en toda la plataforma, así que un
  // dueño creado para un alta que después falla se queda ocupando ese correo
  // para siempre —sin membresía, sin poder entrar a ningún lado— y el segundo
  // intento tomaría la rama de "ya tenía cuenta" y nunca mostraría las
  // credenciales. Por eso el formato y la lista de reservados se comprueban
  // aquí y no se dejan reventar dentro de `provisionTenant`.
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `El identificador "${slug}" está reservado por la plataforma.` };
  }
  try {
    schemaNameFor(slug); // valida el formato; lanza con un mensaje explicativo
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Identificador inválido." };
  }

  const [ocupado] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (ocupado) {
    return { ok: false, error: `El identificador "${slug}" ya lo usa otra empresa. Elige otro.` };
  }

  try {
    // El dueño puede existir ya: el correo es único en TODA la plataforma, así
    // que un consultor que ya atiende a otro cliente reutiliza su cuenta y
    // suma una membresía, en vez de tener dos contraseñas.
    const email = s.email.toLowerCase();
    const [existente] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let ownerId = existente?.id;
    let password = "";

    if (!ownerId) {
      password = tempPassword();
      const [creado] = await db
        .insert(users)
        .values({
          name: s.contactName,
          email,
          company: s.companyName,
          phone: s.phone,
          passwordHash: bcrypt.hashSync(password, 10),
          // El papel de dueño no se pone aquí: lo crea `provisionTenant` como
          // membresía `owner` de la empresa que está naciendo. La cuenta es la
          // identidad; mandar en una empresa es otra cosa.
          // Nunca de plataforma: es el dueño de SU empresa, no operador del SaaS.
          platformRole: null,
          active: true,
        })
        .returning({ id: users.id });
      ownerId = creado.id;
    }

    let r;
    try {
      r = await provisionTenant({
        slug,
        name: s.companyName,
        ownerUserId: ownerId,
        plan,
      });
    } catch (e) {
      // Segunda red, por lo que la validación de arriba no puede prever (un
      // esquema a medio crear, la base caída a mitad de la migración). Solo se
      // borra la cuenta si la creó ESTA llamada: la de alguien que ya existía
      // pertenece a otro inquilino y borrarla sería mucho peor que el fallo.
      if (!existente) {
        await db.delete(users).where(eq(users.id, ownerId));
      }
      throw e;
    }

    await db
      .update(tenantSignups)
      .set({
        status: "approved",
        tenantId: r.tenantId,
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
      })
      .where(eq(tenantSignups.id, id));

    await db.insert(platformEvents).values({
      tenantId: r.tenantId,
      eventType: "tenant.signup_approved",
      payload: {
        signupId: id,
        empresa: s.companyName,
        slug,
        esquema: r.schemaName,
        dueno: email,
        cuentaNueva: !existente,
      },
      actorId: session.user.id,
    });

    revalidatePath("/platform");
    return {
      ok: true,
      message: `"${s.companyName}" quedó dada de alta en ${r.schemaName}, con ${r.applied.length} migración(es).`,
      credentials: { email, password, nuevo: !existente },
    };
  } catch (e) {
    console.error("[signup] approve error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/** Rechaza una solicitud. El motivo se guarda para poder sostener la decisión. */
export async function rejectSignup(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePlatform("superadmin");
  if (!session) return { ok: false, error: "Solo un superadministrador rechaza altas." };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) return { ok: false, error: "Falta la solicitud." };
  if (!reason) return { ok: false, error: "Escribe el motivo del rechazo." };

  const db = getDb();
  const [s] = await db
    .select({ id: tenantSignups.id, status: tenantSignups.status, companyName: tenantSignups.companyName })
    .from(tenantSignups)
    .where(eq(tenantSignups.id, id))
    .limit(1);
  if (!s) return { ok: false, error: "La solicitud ya no existe." };
  if (s.status !== "pending") return { ok: false, error: "Esta solicitud ya fue resuelta." };

  await db
    .update(tenantSignups)
    .set({
      status: "rejected",
      rejectionReason: reason.slice(0, 2000),
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
    })
    .where(eq(tenantSignups.id, id));

  await db.insert(platformEvents).values({
    eventType: "tenant.signup_rejected",
    payload: { signupId: id, empresa: s.companyName, motivo: reason.slice(0, 500) },
    actorId: session.user.id,
  });

  revalidatePath("/platform");
  return { ok: true, message: "Solicitud rechazada." };
}
