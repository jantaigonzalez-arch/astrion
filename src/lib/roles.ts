import type { Role } from "@/lib/auth";

/**
 * Permisos por rol.
 * - support (agente/admin): atiende tickets, gestiona equipos.
 * - sales (vendedor/admin): gestiona contratos.
 * - admin: además administra cuentas.
 * El vendedor NO debe tener poderes de soporte, por eso no basta con
 * "todo lo que no sea cliente".
 */
export function isSupport(role: Role | undefined) {
  return role === "agent" || role === "admin";
}

export function isSalesRole(role: Role | undefined) {
  return role === "sales" || role === "admin";
}

export function isAdminRole(role: Role | undefined) {
  return role === "admin";
}

/** Cualquier perfil interno (accede al área /admin del portal). */
export function isInternal(role: Role | undefined) {
  return role === "agent" || role === "admin" || role === "sales";
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  agent: "Agente (soporte)",
  client: "Cliente (laboratorio)",
  sales: "Vendedor",
};
