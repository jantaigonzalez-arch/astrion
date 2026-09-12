"use server";

import { z } from "zod";
import {
  MODULOS,
  NIVELES,
  alcanza,
  nivelEfectivo,
  type Ajustes,
  type Modulo,
  type Nivel,
} from "@/lib/permisos";
import { revalidateTenant } from "@/lib/revalidate";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { requireTenant, tenantDb, puedeEn } from "@/lib/tenancy/context";
import { crmOrganizations } from "@/lib/db/schema";
import { memberships, users } from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import { getTenantMember } from "@/lib/data/people";
import { ASSIGNABLE_ROLES, isAdminRole } from "@/lib/roles";

/**
 * Alta y edición de las personas de UNA empresa.
 *
 * La pieza que faltaba aquí es la membresía. La identidad (`users`) es global —
 * un correo, una persona, en toda la plataforma — y el papel que juega en cada
 * empresa vive en `memberships`. Antes esto escribía solo en `users`: creaba la
 * cuenta y le ponía un rol, pero sin membresía la persona no pertenecía a
 * ninguna empresa y no podía entrar a ningún lado. Se daba de alta a alguien y
 * simplemente no funcionaba.
 *
 * Y en el otro sentido: el `id` llega por formulario, así que sin comprobar la
 * pertenencia un administrador podía editar —o restablecerle la contraseña a—
 * una cuenta de otra empresa. `getTenantMember()` es lo que lo impide, y por eso
 * cada acción empieza por ahí.
 */

/**
 * Del formulario al mapa que se guarda.
 *
 * Solo entra lo que es un módulo conocido con un nivel conocido. Lo demás se
 * DESCARTA en vez de guardarse: cadena vacía significa «que decida el rol», y
 * cualquier otra cosa es una manipulación del formulario o un módulo que esta
 * versión ya no tiene. Guardar un nivel inventado dejaría una fila que nadie
 * sabe interpretar en la columna que decide quién entra a dónde.
 *
 * Es la misma red que `ajustesGuardados()` pone al LEER, y las dos hacen falta:
 * ésta impide que la basura entre, aquélla impide que una fila vieja rompa la
 * lectura. Una sola no alcanza — la columna sobrevive a los despliegues.
 */
function aAjustes(crudo: Record<string, string>): Ajustes {
  const out: Ajustes = {};
  for (const m of MODULOS) {
    const v = crudo[m];
    if (!v) continue; // "" = sin ajuste, sigue al rol
    if (!(NIVELES as readonly string[]).includes(v)) continue;
    out[m as Modulo] = v as Nivel;
  }
  return out;
}

/* ---------------- Editar a alguien de la empresa ---------------- */
const UpdateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(160),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  role: z.enum(ASSIGNABLE_ROLES),
  active: z.boolean(),
  /*
    Los ajustes de acceso, uno por módulo, como campos sueltos del formulario.

    Llegan como `permiso.compras=ver`, y no como un JSON en un campo oculto,
    porque así el formulario funciona sin JavaScript y porque cada `<select>` es
    su propio campo con su propio nombre — que es lo que hace que el navegador
    sepa reenviarlos y que un error de uno no arrastre a los otros.

    «Que decida el rol» viaja como cadena vacía y NO como un valor más: es la
    ausencia de ajuste, y guardarla como un nivel congelaría la plantilla del
    rol en esa cuenta. Ver `Ajustes` en `lib/permisos.ts`.
  */
  permisos: z.record(z.string(), z.string()).default({}),
  // Organización del CRM que representa a esta cuenta ("" = sin vincular).
  crmOrganizationId: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
      message: "organización inválida",
    }),
});

export type UpdateUserState = {
  ok: boolean;
  error?: "auth" | "invalid" | "self" | "owner" | "compartida" | "server";
};

export async function updateUser(
  _prev: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("configuracion", "administrar"))) {
    return { ok: false, error: "auth" };
  }

  const parsed = UpdateUserSchema.safeParse({
    permisos: Object.fromEntries(
      MODULOS.map((m) => [m, String(formData.get(`permiso.${m}`) ?? "")]),
    ),
    id: formData.get("id"),
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
    role: formData.get("role"),
    active: formData.get("active") === "on",
    crmOrganizationId: (formData.get("crmOrganizationId") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  // Que pertenezca a ESTA empresa. El id viaja en el formulario.
  const target = await getTenantMember(parsed.data.id);
  if (!target) return { ok: false, error: "invalid" };

  // Al dueño no lo toca un administrador: la titularidad de la cuenta se
  // transfiere, no se edita desde el listado de usuarios.
  if (target.role === "owner") return { ok: false, error: "owner" };

  // Evita que un admin se quite a sí mismo el acceso.
  //
  // Mirar el rol y la baja no alcanzaba: el ajuste por persona REEMPLAZA al rol
  // en su módulo (`nivelEfectivo`), así que un administrador podía guardarse
  // `configuracion: ninguno` —rol admin, activo— y quedarse fuera de Usuarios,
  // que es justo la pantalla donde eso se deshace. Lo encontró
  // `scripts/_probe-acciones-usuarios.ts`.
  const ajustes = aAjustes(parsed.data.permisos);
  if (
    parsed.data.id === session.user.id &&
    (!isAdminRole(parsed.data.role) ||
      !parsed.data.active ||
      !alcanza(nivelEfectivo(parsed.data.role, ajustes, "configuracion"), "administrar"))
  ) {
    return { ok: false, error: "self" };
  }

  try {
    const { tenantId } = await requireTenant();
    const control = getDb();

    // El perfil es de la persona y vale en toda la plataforma; el rol y la
    // pertenencia son de esta empresa. Por eso son dos escrituras a dos tablas
    // y no un solo update: `active` aquí significa "sigue con nosotros", no
    // "puede iniciar sesión" — apagar la cuenta global dejaría fuera a un
    // consultor que además atiende a otros clientes.
    await control
      .update(users)
      .set({
        name: parsed.data.name,
        company: parsed.data.company ?? null,
        phone: parsed.data.phone ?? null,
      })
      .where(eq(users.id, parsed.data.id));

    await control
      .update(memberships)
      .set({
        role: parsed.data.role,
        active: parsed.data.active,
        permissions: ajustes,
      })
      .where(
        and(
          eq(memberships.userId, parsed.data.id),
          eq(memberships.tenantId, tenantId),
        ),
      );

    // Vínculo con el CRM: una cuenta representa como mucho a una organización.
    // Primero suelta la que la tuviera asignada, luego enlaza la elegida.
    const db = await tenantDb();
    const orgId = parsed.data.crmOrganizationId;
    await db
      .update(crmOrganizations)
      .set({ clientId: null })
      .where(
        and(
          eq(crmOrganizations.clientId, parsed.data.id),
          orgId ? ne(crmOrganizations.id, orgId) : undefined,
        ),
      );
    if (orgId) {
      await db
        .update(crmOrganizations)
        .set({ clientId: parsed.data.id })
        .where(eq(crmOrganizations.id, orgId));
    }

    revalidateTenant();
    return { ok: true };
  } catch (e) {
    console.error("[user] update error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------------- Restablecer contraseña ---------------- */
export async function resetUserPassword(
  _prev: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("configuracion", "administrar"))) {
    return { ok: false, error: "auth" };
  }

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  // El uuid se valida aquí y no se deja a Postgres: un id que no lo es llegaba
  // tal cual a `getTenantMember` y la acción reventaba con «invalid input
  // syntax for type uuid» —un 500— en vez de responder «inválido». Lo encontró
  // `scripts/_probe-acciones-usuarios.ts`.
  if (!z.string().uuid().safeParse(id).success || password.length < 8) {
    return { ok: false, error: "invalid" };
  }

  // La comprobación de pertenencia pesa más aquí que en ninguna otra acción:
  // la contraseña abre la sesión en TODAS las empresas de esa persona. Sin
  // esto, el administrador de un laboratorio podía apoderarse de la cuenta de
  // alguien de otro con solo mandar su uuid.
  const target = await getTenantMember(id);
  if (!target) return { ok: false, error: "invalid" };
  if (target.role === "owner") return { ok: false, error: "owner" };

  /*
    Y SOLO SI ES DE ESTA EMPRESA Y DE NINGUNA OTRA.

    Comprobar que pertenece aquí no bastaba, por la misma razón de arriba: la
    contraseña es de la persona, no de la membresía. Alguien que es agente aquí
    y dueño en otra empresa quedaba al alcance de este formulario, y el
    administrador de aquí entraba allá como dueño. Lo encontró
    `_probe-acciones-usuarios`. Quien trabaja en varias empresas no es de
    ninguna en particular: su contraseña la restablece soporte de la plataforma.
  */
  const { tenantId } = await requireTenant();
  const [enOtra] = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, id),
        ne(memberships.tenantId, tenantId),
        eq(memberships.active, true),
      ),
    )
    .limit(1);
  if (enOtra) return { ok: false, error: "compartida" };

  try {
    const control = getDb();
    await control
      .update(users)
      .set({ passwordHash: bcrypt.hashSync(password, 10) })
      .where(eq(users.id, id));
    return { ok: true };
  } catch (e) {
    console.error("[user] reset password error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------------- Dar de alta en la empresa ---------------- */
const CreateUserSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().max(255),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  role: z.enum(ASSIGNABLE_ROLES),
  password: z.string().min(8).max(200),
});

export type CreateUserState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "server";
  createdEmail?: string;
  createdId?: string;
  createdRole?: (typeof ASSIGNABLE_ROLES)[number];
  /** La cuenta ya existía en la plataforma: se le dio acceso, no se creó. */
  linkedExisting?: boolean;
};

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  // Solo un administrador puede dar de alta cuentas (acceso por invitación).
  if (!(await puedeEn("configuracion", "administrar"))) {
    return { ok: false, error: "auth" };
  }

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone") || undefined,
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const email = parsed.data.email.toLowerCase().trim();

  try {
    const { tenantId } = await requireTenant();
    const control = getDb();

    const [existing] = await control
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Ya es de la casa: eso no es un alta. Cambiarle el rol desde aquí, en
    // silencio, sería hacer pasar una edición por una creación — para eso está
    // la pantalla de edición, que además deja claro qué se está cambiando.
    if (existing) {
      const already = await control
        .select({ active: memberships.active })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, existing.id),
            eq(memberships.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (already[0]?.active) return { ok: false, error: "duplicate" };
    }

    /**
     * Una identidad, muchas membresías.
     *
     * Si el correo ya existe en la plataforma NO se crea otra cuenta ni se toca
     * la que hay: se le añade la membresía a esta empresa. Es el caso del
     * ingeniero que atiende a dos laboratorios y quiere entrar a los dos con la
     * misma contraseña. Antes esto devolvía "duplicado" y no había forma de
     * darlo de alta.
     *
     * Lo que NO se hace es pisar su contraseña: la contraseña del formulario se
     * ignora para una cuenta que ya existía. Aceptarla convertiría "dar de alta
     * a un colega" en "apoderarme de su cuenta".
     */
    const userId =
      existing?.id ??
      (
        await control
          .insert(users)
          .values({
            name: parsed.data.name,
            email,
            company: parsed.data.company,
            phone: parsed.data.phone,
            passwordHash: bcrypt.hashSync(parsed.data.password, 10),
            active: true,
          })
          .returning({ id: users.id })
      )[0].id;

    // Reactivar una baja es dar de alta otra vez: la fila ya existe (hay índice
    // único por persona y empresa), así que el alta la revive con el rol nuevo
    // en vez de estrellarse contra el índice.
    const [membership] = await control
      .insert(memberships)
      .values({
        userId,
        tenantId,
        role: parsed.data.role,
        active: true,
        acceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.tenantId],
        set: { role: parsed.data.role, active: true },
      })
      .returning({ id: memberships.id });
    if (!membership) return { ok: false, error: "server" };

    revalidateTenant();
    return {
      ok: true,
      createdEmail: email,
      createdId: userId,
      createdRole: parsed.data.role,
      linkedExisting: Boolean(existing),
    };
  } catch (e) {
    console.error("[user] create error:", e);
    return { ok: false, error: "server" };
  }
}
