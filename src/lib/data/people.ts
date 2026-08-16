import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { memberships, users, type MembershipRole } from "@/lib/db/platform";
import { requireTenant } from "@/lib/tenancy/context";

/**
 * Las personas de la EMPRESA ACTIVA.
 *
 * Por qué existe este módulo en vez de consultar `users` desde cada sitio:
 * `users` vive en `public` porque la identidad es única en toda la plataforma —
 * una persona, un correo, muchas empresas. Eso es deliberado y no va a cambiar.
 * Pero significa que `users` es la ÚNICA tabla del sistema donde el aislamiento
 * no lo da el esquema: un `select * from users` desde el esquema de un
 * inquilino devuelve el padrón completo de la plataforma, incluidos los
 * clientes de la competencia. No falla, no avisa: devuelve de más.
 *
 * El filtro por `memberships` es lo que restituye el aislamiento, y por eso
 * está en un solo lugar. Antes estaba repetido —mejor dicho, ausente— en siete
 * consultas: seis páginas y una ruta de exportación listaban gente de otras
 * empresas. Una función que se puede olvidar de filtrar se olvida; una que
 * arranca de `memberships` y llega a `users` por join no tiene forma de hacerlo.
 *
 * La consulta usa `getDb()` y no `tenantDb()` a propósito: `users` y
 * `memberships` son plano de control. El inquilino entra como un valor
 * (`tenantId`), no como el esquema de la conexión.
 */

/**
 * Cómo se ve una persona dentro de una empresa: sus datos + el papel que juega aquí.
 *
 * Hay DOS banderas de "activo" y confundirlas hace daño en direcciones opuestas:
 *
 * - `accountActive` (`users.active`) es la cuenta en toda la plataforma. Ponerla
 *   en falso impide iniciar sesión **en todas** las empresas. Es de plataforma,
 *   no de un cliente: si el administrador de un laboratorio pudiera apagarla,
 *   dejaría fuera a un consultor que además atiende a otros tres.
 * - `memberActive` (`memberships.active`) es la pertenencia a ESTA empresa. Es
 *   la que un administrador da y quita: "esta persona ya no trabaja con
 *   nosotros" no significa "esta persona ya no existe".
 *
 * Para "¿quién puede operar aquí?" hay que exigir las dos.
 */
export type TenantMember = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  image: string | null;
  createdAt: Date;
  /** Rol EN ESTA empresa. La misma persona puede tener otro en otra. */
  role: MembershipRole;
  /** La cuenta puede iniciar sesión en la plataforma. */
  accountActive: boolean;
  /** Sigue perteneciendo a esta empresa. */
  memberActive: boolean;
};

const MEMBER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  company: users.company,
  phone: users.phone,
  image: users.image,
  createdAt: users.createdAt,
  role: memberships.role,
  accountActive: users.active,
  memberActive: memberships.active,
};

/**
 * Personas con membresía en la empresa activa.
 *
 * Por omisión devuelve solo a quien puede operar hoy, que es lo que quiere
 * cualquier `<select>` de asignación. El padrón de administración pide
 * `includeInactive` porque es justamente la pantalla desde la que se readmite a
 * alguien: esconder a los inactivos la dejaría sin forma de deshacer una baja.
 */
export type MemberListOptions = {
  roles?: readonly MembershipRole[];
  /** Incluir bajas: pertenencias revocadas y cuentas deshabilitadas. */
  includeInactive?: boolean;
  orderBy?: "name" | "company" | "createdAt";
};

export async function listTenantMembers(
  opts?: MemberListOptions,
): Promise<TenantMember[]> {
  const { tenantId } = await requireTenant();
  return listTenantMembersFor(tenantId, opts);
}

/**
 * Igual que la anterior con la empresa explícita, para lo que corre fuera de una
 * petición: scripts, importadores, tareas programadas y las pruebas de
 * aislamiento.
 *
 * Mismo par que `tenantDb()` / `tenantDbFor()`. Que el filtro viva en la misma
 * consulta para los dos caminos es justamente el punto: si la versión "de
 * script" reimplementara el join, sería la que se olvidaría de filtrar.
 */
export async function listTenantMembersFor(
  tenantId: string,
  opts?: MemberListOptions,
): Promise<TenantMember[]> {
  const db = getDb();

  const order =
    opts?.orderBy === "company"
      ? asc(users.company)
      : opts?.orderBy === "createdAt"
        ? desc(users.createdAt)
        : asc(users.name);

  return db
    .select(MEMBER_COLUMNS)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        opts?.includeInactive ? undefined : eq(memberships.active, true),
        opts?.includeInactive ? undefined : eq(users.active, true),
        opts?.roles?.length ? inArray(memberships.role, [...opts.roles]) : undefined,
      ),
    )
    .orderBy(order);
}

/**
 * Una persona concreta, **si pertenece** a la empresa activa.
 *
 * Devuelve `null` para un id que existe en la plataforma pero es de otra
 * empresa. Esa es toda la diferencia con un `select ... where id = ?`, y es la
 * que impide que cambiar el uuid de la URL muestre la ficha de un cliente ajeno.
 */
export async function getTenantMember(userId: string): Promise<TenantMember | null> {
  const { tenantId } = await requireTenant();
  return getTenantMemberFor(tenantId, userId);
}

/** Igual que la anterior con la empresa explícita. Ver `listTenantMembersFor`. */
export async function getTenantMemberFor(
  tenantId: string,
  userId: string,
): Promise<TenantMember | null> {
  const db = getDb();

  // Devuelve también las bajas: quien llama decide si le sirven. La pantalla de
  // edición necesita cargar a alguien dado de baja para poder readmitirlo,
  // mientras que asignar un ticket comprueba `memberActive` y lo rechaza.
  const [row] = await db
    .select(MEMBER_COLUMNS)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .limit(1);

  return row ?? null;
}

/** El rol de una persona en la empresa activa, o `null` si no es miembro. */
export async function getMemberRole(userId: string): Promise<MembershipRole | null> {
  const member = await getTenantMember(userId);
  return member?.role ?? null;
}

/**
 * Rol en esta empresa de varias personas de golpe, indexado por id.
 *
 * Para pintar "quién escribió esto" en una bitácora de ticket sin una consulta
 * por comentario. Quien no aparezca en el mapa no es miembro: puede ser alguien
 * dado de baja que dejó comentarios cuando trabajaba aquí, y esa fila del
 * historial no se borra ni se falsea — simplemente no lleva rol al lado.
 */
export async function rolesByUser(
  userIds: readonly string[],
): Promise<Map<string, MembershipRole>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();

  const { tenantId } = await requireTenant();
  const db = getDb();

  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids)),
    );

  return new Map(rows.map((r) => [r.userId, r.role]));
}
