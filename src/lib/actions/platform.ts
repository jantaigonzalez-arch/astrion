"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
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
import { currentPlatformRole } from "@/lib/platform-session";

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

/**
 * La sesión, si quien la trae opera la plataforma con el nivel que hace falta.
 *
 * El rol sale de `currentPlatformRole()` —o sea de la BASE— y no de
 * `session.user.platformRole`, que es lo que el token dijo el día que la
 * persona entró. Con sesión JWT y sin tabla que invalidar, leerlo del token
 * significaba que degradar a un superadministrador no surtía efecto durante
 * treinta días. Ver la cabecera de `platform-session.ts`.
 *
 * La sesión se sigue devolviendo porque quien llama necesita el `id` para
 * firmar lo que escribe; lo que ya no sale de ella es el permiso.
 */
async function requirePlatform(level: "superadmin" | "any" = "any") {
  const [session, role] = await Promise.all([auth(), currentPlatformRole()]);
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
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePlatform("superadmin");
  if (!session) return { ok: false, error: "Solo un superadministrador da de alta empresas." };

  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!slug || !name) return { ok: false, error: "Faltan el identificador o el nombre." };

  /*
    EL DUEÑO SE PIDE, NO SE SUPONE.

    Pasaba `session.user.id` como dueño: el del operador. Desde la 0023 los
    operadores viven en `platform_users` y la membresía apunta a `users`, así
    que el alta desde la consola fallaba SIEMPRE contra la llave foránea —y con
    el operador antiguo, que conservó su uuid en las dos tablas, funcionaba pero
    dejaba de dueña a su cuenta de empresa—. Lo encontró
    `_probe-acciones-plataforma`. Ahora es como aprobar una solicitud: se da el
    correo de quien va a mandar en la empresa, y se crea o se reutiliza su
    cuenta.
  */
  const dueno = DuenoSchema.safeParse({
    email: formData.get("ownerEmail"),
    name: formData.get("ownerName"),
  });
  if (!dueno.success) {
    return { ok: false, error: "Falta el nombre o un correo válido del dueño." };
  }

  const invalido = await identificadorInvalido(slug);
  if (invalido) return { ok: false, error: invalido };

  try {
    const alta = await darDeAltaConDueno({
      slug,
      name,
      dueno: { email: dueno.data.email, name: dueno.data.name, company: name },
    });
    await getDb().insert(platformEvents).values({
      tenantId: alta.r.tenantId,
      eventType: "tenant.created",
      payload: { empresa: name, slug, esquema: alta.r.schemaName, dueno: alta.email, cuentaNueva: alta.nuevo },
      actorId: session.user.id,
    });
    revalidatePath("/platform");
    return {
      ok: true,
      message: `Empresa "${name}" creada en el esquema ${alta.r.schemaName}, con ${alta.r.applied.length} migración(es) aplicada(s).`,
      credentials: { email: alta.email, password: alta.password, nuevo: alta.nuevo },
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

/*
  El id de la solicitud viaja en un campo oculto. Uno que no era uuid llegaba
  tal cual a la consulta y la acción reventaba en Postgres («invalid input
  syntax for type uuid») con un 500, en vez de responder lo mismo que para una
  solicitud que no existe —que es lo que es—. Lo encontró
  `scripts/_probe-acciones-plataforma.ts`.
*/
const esUuid = (v: string) => z.string().uuid().safeParse(v).success;

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

const DuenoSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(2).max(160),
});

/**
 * Por qué no sirve este identificador, o `null` si sirve.
 *
 * TODA la validación del identificador va antes de tocar nada.
 *
 * No es cosmético: el correo es único en toda la plataforma, así que un
 * dueño creado para un alta que después falla se queda ocupando ese correo
 * para siempre —sin membresía, sin poder entrar a ningún lado— y el segundo
 * intento tomaría la rama de "ya tenía cuenta" y nunca mostraría las
 * credenciales. Por eso el formato y la lista de reservados se comprueban
 * aquí y no se dejan reventar dentro de `provisionTenant`.
 */
async function identificadorInvalido(slug: string): Promise<string | null> {
  if (RESERVED_SLUGS.has(slug)) {
    return `El identificador "${slug}" está reservado por la plataforma.`;
  }
  try {
    schemaNameFor(slug); // valida el formato; lanza con un mensaje explicativo
  } catch (e) {
    return e instanceof Error ? e.message : "Identificador inválido.";
  }
  const [ocupado] = await getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return ocupado ? `El identificador "${slug}" ya lo usa otra empresa. Elige otro.` : null;
}

/**
 * Crea (o reutiliza) la cuenta del dueño y aprovisiona la empresa con él.
 *
 * Lo comparten el alta desde la consola y la aprobación de una solicitud: son
 * la misma operación con otro origen de datos, y cuando vivía dos veces una de
 * las copias se quedó apuntando a un dueño que ya no podía existir.
 */
async function darDeAltaConDueno(a: {
  slug: string;
  name: string;
  plan?: string;
  dueno: { email: string; name: string; company?: string | null; phone?: string | null };
}) {
  const db = getDb();
  // El dueño puede existir ya: el correo es único en TODA la plataforma, así
  // que un consultor que ya atiende a otro cliente reutiliza su cuenta y
  // suma una membresía, en vez de tener dos contraseñas.
  const email = a.dueno.email.toLowerCase();
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
        name: a.dueno.name,
        email,
        company: a.dueno.company ?? null,
        phone: a.dueno.phone ?? null,
        passwordHash: bcrypt.hashSync(password, 10),
        // El papel de dueño no se pone aquí: lo crea `provisionTenant` como
        // membresía `owner` de la empresa que está naciendo. La cuenta es la
        // identidad; mandar en una empresa es otra cosa.
        //
        // Y no hay nada que decir sobre la plataforma: quien opera Astraion
        // vive en `platform_users` y no se llega ahí dando de alta una empresa.
        active: true,
      })
      .returning({ id: users.id });
    ownerId = creado.id;
  }

  try {
    const r = await provisionTenant({ slug: a.slug, name: a.name, ownerUserId: ownerId, plan: a.plan });
    return { r, email, password, nuevo: !existente };
  } catch (e) {
    // Segunda red, por lo que la validación de antes no puede prever (un
    // esquema a medio crear, la base caída a mitad de la migración). Solo se
    // borra la cuenta si la creó ESTA llamada: la de alguien que ya existía
    // pertenece a otro inquilino y borrarla sería mucho peor que el fallo.
    if (!existente) {
      await db.delete(users).where(eq(users.id, ownerId));
    }
    throw e;
  }
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
  if (!esUuid(id)) return { ok: false, error: "La solicitud ya no existe." };

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

  const invalido = await identificadorInvalido(slug);
  if (invalido) return { ok: false, error: invalido };

  try {
    const { r, email, password, nuevo } = await darDeAltaConDueno({
      slug,
      name: s.companyName,
      plan,
      dueno: { email: s.email, name: s.contactName, company: s.companyName, phone: s.phone },
    });

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
        cuentaNueva: nuevo,
      },
      actorId: session.user.id,
    });

    revalidatePath("/platform");
    return {
      ok: true,
      message: `"${s.companyName}" quedó dada de alta en ${r.schemaName}, con ${r.applied.length} migración(es).`,
      credentials: { email, password, nuevo },
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
  if (!esUuid(id)) return { ok: false, error: "La solicitud ya no existe." };

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
