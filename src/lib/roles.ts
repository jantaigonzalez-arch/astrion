import type { MembershipRole } from "@/lib/db/platform";

/**
 * Permisos por rol DENTRO de un inquilino.
 *
 * El rol que entra aquí es el de la membresía en la empresa activa, no una
 * propiedad de la persona: la misma cuenta puede ser `agent` en un laboratorio
 * y `owner` en otro. Se obtiene con `currentRole()` (ver `tenancy/context.ts`),
 * nunca de la sesión — `session.user` identifica QUIÉN es, no QUÉ puede hacer
 * aquí.
 *
 * - support (agente/admin/dueño): atiende tickets, gestiona equipos.
 * - sales (vendedor/admin/dueño): gestiona contratos.
 * - admin: además administra cuentas y configuración.
 * - owner: todo lo de admin, más lo que no debe poder cualquier administrador
 *   (ver `isOwner`).
 *
 * El vendedor NO debe tener poderes de soporte, por eso no basta con
 * "todo lo que no sea cliente".
 */

/** Rol efectivo: `null` cuando no hay empresa activa o la persona no es miembro. */
export type EffectiveRole = MembershipRole | null | undefined;

export function isSupport(role: EffectiveRole) {
  return role === "agent" || role === "admin" || role === "owner";
}

export function isSalesRole(role: EffectiveRole) {
  return role === "sales" || role === "admin" || role === "owner";
}

export function isAdminRole(role: EffectiveRole) {
  return role === "admin" || role === "owner";
}

/**
 * Facultades del dueño de la cuenta, que un administrador NO tiene: facturación,
 * invitar administradores y dar o revocar el consentimiento de datos para
 * modelos globales.
 *
 * Esa última es la razón de que `owner` exista como rol aparte. Ceder los datos
 * de un laboratorio al entrenamiento de un modelo compartido es una decisión
 * comercial de quien firma el contrato, no una casilla que pueda marcar
 * cualquiera con permisos de administración.
 */
export function isOwner(role: EffectiveRole) {
  return role === "owner";
}

/** Cualquier perfil interno (accede al área /admin del portal). */
export function isInternal(role: EffectiveRole) {
  return role === "agent" || role === "admin" || role === "sales" || role === "owner";
}

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Dueño de la cuenta",
  admin: "Administrador",
  agent: "Agente (soporte)",
  client: "Cliente (laboratorio)",
  sales: "Vendedor",
};

/**
 * Roles que un administrador puede asignar al dar de alta o editar a alguien.
 *
 * `owner` queda fuera a propósito: se otorga al aprovisionar el inquilino y
 * cambiarlo es transferir la titularidad de la cuenta, no editar un usuario.
 */
export const ASSIGNABLE_ROLES = ["admin", "agent", "sales", "client"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
