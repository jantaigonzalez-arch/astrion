import "server-only";
import { ordenarPor } from "@/lib/data/orden";
import type { Orden } from "@/lib/listado";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
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
  /**
   * Ajustes de acceso por módulo, encima del rol. `unknown` porque es `jsonb`:
   * pasa por `ajustesGuardados()` antes de usarse. Ver `lib/permisos.ts`.
   */
  permissions: unknown;
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
  /** Ajustes de acceso por módulo. Ver `lib/permisos.ts`. */
  permissions: memberships.permissions,
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
  /**
   * Orden fijo, para las llamadas que no vienen de una pantalla con URL —los
   * `<select>` de asignación, el padrón de un correo—. Convive con `orden`: si
   * llegan los dos, manda el de la URL, que es el que pidió una persona.
   */
  orderBy?: "name" | "company" | "createdAt";
  /** Orden pedido desde la URL. Ver `lib/listado.ts`. */
  orden?: Orden<CampoOrdenMiembro>;
  /**
   * Filtro por rol pedido desde la pantalla.
   *
   * Distinto de `roles`, que es el que fija quien llama —«dame solo agentes
   * para este `<select>`»—. Si llegan los dos se aplican los dos: el de la URL
   * no puede ampliar lo que quien llama acotó, o el desplegable de asignación
   * ofrecería clientes con solo escribir `?rol=client`.
   */
  rol?: MembershipRole;
  /** `true` solo activos, `false` solo bajas, ausente = todos. */
  activo?: boolean;
};

/**
 * Por qué columnas se puede ordenar el padrón de la empresa.
 *
 * Lista blanca: `?orden=` es texto de fuera y aquí se vuelve columna o nada.
 *
 * `rol` ordena por el ENUM de Postgres, o sea por el orden en que se declaró
 * —dueño, administrador, agente, vendedor, cliente—, que resulta ser de más a
 * menos alcance. Es lo que se quiere al ordenar por rol: agrupar por lo que
 * cada quien puede hacer, no alfabéticamente por su nombre.
 */
const ORDEN_MIEMBROS = {
  nombre: users.name,
  correo: users.email,
  empresa: users.company,
  rol: memberships.role,
  alta: users.createdAt,
} as const;
export type CampoOrdenMiembro = keyof typeof ORDEN_MIEMBROS;
export const CAMPOS_ORDEN_MIEMBROS = Object.keys(
  ORDEN_MIEMBROS,
) as CampoOrdenMiembro[];

/** Por nombre: a un padrón se viene a buscar a alguien. */
export const ORDEN_MIEMBROS_DEFECTO: Orden<CampoOrdenMiembro> = {
  campo: "nombre",
  dir: "asc",
};

/**
 * Cuánta gente cae en cada opción del filtro del padrón.
 *
 * Sobre el padrón COMPLETO —bajas incluidas— y no sobre lo ya filtrado: el menú
 * tiene que poder decir «hay 6 agentes» aunque estés mirando a los clientes.
 * Cambiar de filtro sin ese número es un salto a ciegas.
 */
export async function contarMiembros(tenantId: string): Promise<{
  rol: Array<{ k: MembershipRole; n: number }>;
  activos: number;
  bajas: number;
}> {
  const db = getDb();
  const filas = await db
    .select({
      rol: memberships.role,
      vivo: sql<boolean>`${memberships.active} and ${users.active}`,
      n: sql<number>`count(*)::int`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .groupBy(memberships.role, sql`${memberships.active} and ${users.active}`);

  const porRol = new Map<MembershipRole, number>();
  let activos = 0;
  let bajas = 0;
  for (const f of filas) {
    porRol.set(f.rol, (porRol.get(f.rol) ?? 0) + f.n);
    if (f.vivo) activos += f.n;
    else bajas += f.n;
  }
  return {
    rol: [...porRol].map(([k, n]) => ({ k, n })),
    activos,
    bajas,
  };
}

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

  // El de la URL manda sobre el fijo: uno lo pidió una persona y el otro es el
  // que trae por omisión quien llama.
  const order = opts?.orden
    ? ordenarPor(opts.orden, ORDEN_MIEMBROS, users.id)
    : [
        opts?.orderBy === "company"
          ? asc(users.company)
          : opts?.orderBy === "createdAt"
            ? desc(users.createdAt)
            : asc(users.name),
      ];

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
        opts?.rol ? eq(memberships.role, opts.rol) : undefined,
        opts?.activo === undefined
          ? undefined
          : opts.activo
            ? and(eq(memberships.active, true), eq(users.active, true))
            : or(eq(memberships.active, false), eq(users.active, false)),
      ),
    )
    .orderBy(...order);
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
