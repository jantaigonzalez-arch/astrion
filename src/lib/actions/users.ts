"use server";

import { z } from "zod";
import { revalidateTenant } from "@/lib/revalidate";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { requireTenant, tenantDb, currentRole } from "@/lib/tenancy/context";
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

/* ---------------- Editar a alguien de la empresa ---------------- */
const UpdateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(160),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  role: z.enum(ASSIGNABLE_ROLES),
  active: z.boolean(),
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
  error?: "auth" | "invalid" | "self" | "owner" | "server";
};

export async function updateUser(
  _prev: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) {
    return { ok: false, error: "auth" };
  }

  const parsed = UpdateUserSchema.safeParse({
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
  if (
    parsed.data.id === session.user.id &&
    (!isAdminRole(parsed.data.role) || !parsed.data.active)
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
      .set({ role: parsed.data.role, active: parsed.data.active })
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
  if (!session?.user || !isAdminRole(await currentRole())) {
    return { ok: false, error: "auth" };
  }

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id || password.length < 8) return { ok: false, error: "invalid" };

  // La comprobación de pertenencia pesa más aquí que en ninguna otra acción:
  // la contraseña abre la sesión en TODAS las empresas de esa persona. Sin
  // esto, el administrador de un laboratorio podía apoderarse de la cuenta de
  // alguien de otro con solo mandar su uuid.
  const target = await getTenantMember(id);
  if (!target) return { ok: false, error: "invalid" };
  if (target.role === "owner") return { ok: false, error: "owner" };

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
  if (!isAdminRole(await currentRole())) {
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
