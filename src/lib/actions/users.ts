"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { crmOrganizations } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { auth } from "@/lib/auth";

/* ---------------- Editar cuenta existente ---------------- */
const UpdateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(160),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  role: z.enum(["client", "agent", "admin", "sales"]),
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
  error?: "auth" | "invalid" | "self" | "server";
};

export async function updateUser(
  _prev: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
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

  // Evita que un admin se quite a sí mismo el acceso.
  if (
    parsed.data.id === session.user.id &&
    (parsed.data.role !== "admin" || !parsed.data.active)
  ) {
    return { ok: false, error: "self" };
  }

  try {
    const db = getDb();
    await db
      .update(users)
      .set({
        name: parsed.data.name,
        company: parsed.data.company ?? null,
        phone: parsed.data.phone ?? null,
        role: parsed.data.role,
        active: parsed.data.active,
      })
      .where(eq(users.id, parsed.data.id));

    // Vínculo con el CRM: una cuenta representa como mucho a una organización.
    // Primero suelta la que la tuviera asignada, luego enlaza la elegida.
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
      revalidatePath(`/admin/crm/organizaciones/${orgId}`);
    }
    revalidatePath("/admin/crm/organizaciones");

    revalidatePath("/admin/users");
    // También la página de edición, para que el formulario se re-renderice
    // con los datos nuevos (si no, el select vuelve al valor viejo).
    revalidatePath(`/admin/users/${parsed.data.id}/editar`);
    revalidatePath(`/en/admin/users/${parsed.data.id}/editar`);
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
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, error: "auth" };
  }

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id || password.length < 8) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    await db
      .update(users)
      .set({ passwordHash: bcrypt.hashSync(password, 10) })
      .where(eq(users.id, id));
    return { ok: true };
  } catch (e) {
    console.error("[user] reset password error:", e);
    return { ok: false, error: "server" };
  }
}

const CreateUserSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email().max(255),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  role: z.enum(["client", "agent", "admin", "sales"]),
  password: z.string().min(8).max(200),
});

export type CreateUserState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "server";
  createdEmail?: string;
  createdId?: string;
  createdRole?: "client" | "agent" | "admin" | "sales";
};

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  // Solo un administrador puede dar de alta cuentas (acceso por invitación).
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
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
    const db = getDb();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) return { ok: false, error: "duplicate" };

    const [created] = await db
      .insert(users)
      .values({
        name: parsed.data.name,
        email,
        company: parsed.data.company,
        phone: parsed.data.phone,
        role: parsed.data.role,
        passwordHash: bcrypt.hashSync(parsed.data.password, 10),
        active: true,
      })
      .returning({ id: users.id });

    revalidatePath("/admin/users");
    return {
      ok: true,
      createdEmail: email,
      createdId: created.id,
      createdRole: parsed.data.role,
    };
  } catch (e) {
    console.error("[user] create error:", e);
    return { ok: false, error: "server" };
  }
}
