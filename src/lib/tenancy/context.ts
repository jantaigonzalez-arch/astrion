import { cache } from "react";
import { cookies } from "next/headers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  memberships,
  platformEvents,
  tenants,
  tenantSchemas,
  type MembershipRole,
} from "@/lib/db/platform";
import { auth } from "@/lib/auth";

/**
 * Contexto de inquilino: qué empresa está viendo el usuario en esta petición,
 * y cómo se consultan sus datos.
 *
 * Regla que sostiene el aislamiento: `getDb()` habla con el PLANO DE CONTROL
 * (public) y no ve una sola tabla de negocio. Para leer o escribir negocio hay
 * que pasar por `tenantDb()`, que devuelve un cliente atado al esquema del
 * inquilino activo. Si no hay inquilino activo, no hay cliente — y la consulta
 * falla en vez de devolver datos de otra empresa.
 */

export const ACTIVE_TENANT_COOKIE = "evo_tenant";

/* ============================================================
   Clientes por esquema
   ============================================================ */

type TenantClient = ReturnType<typeof drizzle<typeof schema>>;
/** El pool crudo se guarda junto al cliente porque cerrarlo exige `end()`. */
type TenantPool = { client: TenantClient; sql: ReturnType<typeof postgres> };

/**
 * Pools vivos, en orden de último uso: el primero es el más viejo.
 *
 * Es un LRU y no un Map que solo crece. Antes nunca se purgaba: las conexiones
 * sí se devolvían a los 20 s de inactividad, pero el objeto pool quedaba vivo
 * para siempre. En un proceso de larga vida que atendió mil empresas, son mil
 * pools acumulados — no tumba nada el primer día, aparece a los meses.
 */
const clients = new Map<string, TenantPool>();

/**
 * Conexiones por inquilino activo.
 *
 * Deliberadamente bajo: cada inquilino con actividad mantiene su pool, así que
 * este número se multiplica por cuántas empresas estén trabajando a la vez.
 */
const POOL_MAX = Number(process.env.DB_TENANT_POOL_MAX ?? 2);

/**
 * El TECHO DE CONEXIONES que esta instancia se permite para inquilinos.
 *
 * ── POR QUÉ ES UN PRESUPUESTO Y NO UN NÚMERO DE POOLS ──────────────────────
 *
 * Antes se configuraba cuántos pools caben (64) y, por separado, cuántas
 * conexiones tiene cada uno (3). Nadie multiplica dos ajustes que viven en
 * líneas distintas, y el producto era 192 más 10 del plano de control: 202
 * conexiones contra un `max_connections` que por omisión son 100. Es decir, la
 * configuración por omisión prometía el doble de lo que la base aguanta, y el
 * síntoma no habría sido lentitud sino «too many clients» —la aplicación entera
 * caída, para todos los inquilinos a la vez, cuando el trigésimo se conecta.
 *
 * Con el presupuesto explícito, el número que hay que comparar contra
 * `max_connections` está escrito y no hay que deducirlo. El número de pools se
 * DERIVA de él, así que subir las conexiones por inquilino reduce cuántos caben
 * en memoria en vez de multiplicar el total en silencio.
 *
 * ── CÓMO SE AJUSTA ────────────────────────────────────────────────────────
 *
 * El valor por omisión, 60, deja sitio para el plano de control y margen para
 * migraciones, `psql` y lo que haya conectado, dentro de los 100 de un Postgres
 * sin tocar. Con un servidor mayor se sube `DB_TENANT_CONN_BUDGET`; la regla es
 * que el presupuesto más `DB_POOL_MAX` se queden por debajo de
 * `max_connections` con holgura.
 *
 * El techo es el PEOR caso, no el uso normal: `idle_timeout` devuelve las
 * conexiones de un inquilino a los 20 s sin actividad, así que en operación el
 * número real es bastante menor. Pero el peor caso es el que tira la base.
 */
const CONN_BUDGET = Number(process.env.DB_TENANT_CONN_BUDGET ?? 60);

/**
 * Cuántos pools se conservan antes de cerrar el menos usado.
 *
 * Derivado del presupuesto, no configurado aparte. Cuando hay más inquilinos
 * activos que pools, el LRU cierra el más viejo y el siguiente que llegue paga
 * una reconexión: es un costo de milisegundos, y la alternativa —quedarse sin
 * conexiones— es un error duro que cae sobre todas las empresas a la vez.
 */
const POOL_CACHE_MAX = Math.max(1, Math.floor(CONN_BUDGET / Math.max(1, POOL_MAX)));

/** El techo real de esta instancia, para diagnóstico. */
export const connectionCeiling = () => ({
  porInquilino: POOL_MAX,
  poolsEnCache: POOL_CACHE_MAX,
  techoInquilinos: POOL_CACHE_MAX * POOL_MAX,
  techoControl: Number(process.env.DB_POOL_MAX ?? 10),
  techoTotal: POOL_CACHE_MAX * POOL_MAX + Number(process.env.DB_POOL_MAX ?? 10),
});

/**
 * Cierra el pool menos usado recientemente cuando el mapa se pasa del tope.
 *
 * `end()` espera a que terminen las consultas en vuelo, con un tope de 5 s.
 * Cerrar de golpe rompería una petición a medio camino, y el LRU justamente
 * elige el candidato con menos probabilidad de estar en uso. Si el cierre
 * falla, se traga el error a propósito: la conexión la acabará soltando
 * `idle_timeout`, y tumbar una petición en curso por limpiar un pool sería
 * cambiar un problema lento por uno visible.
 */
function evictOldestPool(): void {
  const oldest = clients.keys().next();
  if (oldest.done) return;
  const pool = clients.get(oldest.value);
  clients.delete(oldest.value);
  void pool?.sql.end({ timeout: 5 }).catch(() => {});
}

/**
 * Un pool pequeño por esquema, con el `search_path` fijado al conectar.
 *
 * Se eligió esto sobre `SET LOCAL search_path` dentro de una transacción por una
 * razón práctica: permite que las ~110 consultas ya escritas sigan con la misma
 * forma (`const db = await tenantDb()`) en vez de reescribirlas todas como
 * callbacks. El aislamiento es igual de estricto — el esquema viaja en la
 * conexión, no en un ajuste que se pueda olvidar.
 *
 * El costo es el número de conexiones: cada inquilino activo mantiene su pool.
 * Por eso `max` es deliberadamente bajo y `idle_timeout` corto: un inquilino que
 * lleva 20 s sin actividad devuelve sus conexiones al sistema. Cuánto se permite
 * gastar en total lo dice `CONN_BUDGET`, y ahí está escrito qué pasa al llegar
 * al techo: se cierran pools, no se abren conexiones de más.
 *
 * Pasado ese punto la respuesta ya no es afinar números sino un pooler externo
 * o el modelo por transacción.
 */
function clientFor(schemaName: string, soloLectura = false): TenantClient {
  // El pool de solo lectura es OTRO pool, no el mismo con un ajuste puesto.
  // `SET SESSION ... READ ONLY` sobre el pool compartido dejaría en solo
  // lectura a todo el que estuviera trabajando en esa empresa, y quitarlo al
  // terminar no es fiable: la conexión vuelve al pool en el estado en que
  // quedó. Dos pools cuestan conexiones —las gobierna el mismo presupuesto y
  // el mismo LRU— y no pueden contaminarse entre sí.
  const clave = soloLectura ? `${schemaName}#ro` : schemaName;

  const cached = clients.get(clave);
  if (cached) {
    // Reinsertar lo manda al final: en un Map el orden es de inserción, así
    // que el primero pasa a ser siempre el menos usado recientemente.
    clients.delete(clave);
    clients.set(clave, cached);
    return cached.client;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");

  // Validación estricta: el search_path no se parametriza, se interpola.
  if (!/^tenant_[a-z0-9_]{1,50}$/.test(schemaName)) {
    throw new Error(`Nombre de esquema inválido: ${JSON.stringify(schemaName)}`);
  }

  const sql = postgres(url, {
    prepare: process.env.DB_PREPARE === "true",
    max: POOL_MAX,
    idle_timeout: Number(process.env.DB_TENANT_IDLE ?? 20),
    connection: {
      search_path: `${schemaName}, public`,
      // Lo hace cumplir POSTGRES, no la aplicación, y ésa es toda la idea: un
      // `INSERT` desde una acción que nadie se acordó de proteger no se cuela,
      // se rechaza. Una comprobación en cada acción es una lista que hay que
      // mantener al día para siempre y que falla en silencio en cuanto alguien
      // escribe la acción número 71.
      ...(soloLectura ? { default_transaction_read_only: true } : {}),
    },
  });

  const client = drizzle(sql, { schema });
  clients.set(clave, { client, sql });
  // Se purga DESPUÉS de insertar: así el pool recién creado nunca es el
  // candidato a cerrarse, que sería absurdo estando a punto de usarse.
  while (clients.size > POOL_CACHE_MAX) evictOldestPool();
  return client;
}

/* ============================================================
   Resolución del inquilino activo
   ============================================================ */

export type TenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  schemaName: string;
  /** Prefijo de los folios de esta empresa: `EVO-000123`. */
  folioPrefix: string;
  /** Rol del usuario EN ESTA empresa. */
  role: MembershipRole;
  /** true si entró por consola de plataforma y no por membresía propia. */
  impersonated: boolean;
};

/**
 * Prefijo de emergencia.
 *
 * Solo aplica a un inquilino dado de alta antes de que la columna existiera y
 * cuyo relleno falló. Es deliberadamente feo: un folio `ORG-000001` se nota y
 * se corrige, mientras que caer a "EVO-" habría repetido en silencio el error
 * que esta columna vino a arreglar.
 */
const FALLBACK_FOLIO_PREFIX = "ORG";

/** Membresías activas del usuario, para el selector de empresa. */
export async function listMemberships(userId: string) {
  const db = getDb();
  return db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      folioPrefix: tenants.folioPrefix,
      role: memberships.role,
      schemaName: tenantSchemas.schemaName,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)));
}

/**
 * Resuelve el inquilino activo, o null si no hay ninguno.
 *
 * Orden: la cookie manda si el usuario tiene derecho a ese inquilino; si no,
 * cae a su única membresía. Un superadministrador puede tener cookie de una
 * empresa donde NO es miembro — eso es entrar por consola, y queda marcado
 * como `impersonated` para que la UI lo muestre y nadie confunda "administrar
 * mi empresa" con "estar dentro de la de un cliente".
 *
 * Memoizado por petición con `cache()` de React. No es un adorno: `tenantDb()`
 * llama aquí, y `tenantDb()` se invoca en CADA una de las ~110 funciones de
 * datos. Sin memoizar, una pantalla que hace diez consultas repetía diez veces
 * `auth()` y la consulta de membresías. La memoización dura lo que la
 * petición, así que no puede servir el inquilino de otro usuario.
 */
export const getTenantContext = cache(async function getTenantContext(): Promise<TenantContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const jar = await cookies();
  const wanted = jar.get(ACTIVE_TENANT_COOKIE)?.value ?? null;

  /**
   * Un operador de Astraion NO tiene membresías, así que no se preguntan.
   *
   * No es una optimización: preguntarlas era un agujero. `session.user.id` de
   * una sesión de plataforma es un id de `platform_users`, y la migración 0023
   * conservó los UUID al separar las tablas —para no remapear la bitácora—, así
   * que ese mismo id TAMBIÉN identifica a una fila de `users` cuando la persona
   * tenía cuenta en las dos. `listMemberships` encontraba las membresías de esa
   * otra cuenta y el operador entraba a la empresa como `owner`, con
   * `impersonated: false` y sin el pool de solo lectura. Medido: entrando a
   * bajío con `admin@astraion.com` salía «Hola, Administrador de Astraion» y el
   * panel de un miembro.
   *
   * De qué TABLA salió la sesión es el hecho; las membresías son de la otra.
   * Cruzarlas por el id es exactamente lo que separar las tablas vino a impedir.
   */
  const esOperador = session.user.kind === "platform";
  const mine = esOperador ? [] : await listMemberships(session.user.id);

  if (wanted) {
    const own = mine.find((m) => m.slug === wanted);
    if (own?.schemaName) {
      return {
        tenantId: own.tenantId,
        slug: own.slug,
        name: own.name,
        schemaName: own.schemaName,
        folioPrefix: own.folioPrefix ?? FALLBACK_FOLIO_PREFIX,
        role: own.role,
        impersonated: false,
      };
    }
    // Sin membresía: solo pasa si es personal de la plataforma. Para un
    // operador éste es SIEMPRE el camino, porque arriba no se le buscaron.
    if (esOperador) {
      const db = getDb();
      const [t] = await db
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          folioPrefix: tenants.folioPrefix,
          schemaName: tenantSchemas.schemaName,
        })
        .from(tenants)
        .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
        .where(eq(tenants.slug, wanted))
        .limit(1);
      if (t?.schemaName) {
        return {
          tenantId: t.tenantId,
          slug: t.slug,
          name: t.name,
          schemaName: t.schemaName,
          folioPrefix: t.folioPrefix ?? FALLBACK_FOLIO_PREFIX,
          role: "admin",
          impersonated: true,
        };
      }
    }
  }

  const only = mine.find((m) => m.schemaName);
  if (!only?.schemaName) return null;
  return {
    tenantId: only.tenantId,
    slug: only.slug,
    name: only.name,
    schemaName: only.schemaName,
    folioPrefix: only.folioPrefix ?? FALLBACK_FOLIO_PREFIX,
    role: only.role,
    impersonated: false,
  };
});

/** Igual que el anterior pero falla si no hay inquilino: para código que lo exige. */
export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) {
    throw new Error(
      "No hay empresa activa. Toda consulta de negocio necesita una: elegí una empresa o entrá desde la consola de plataforma.",
    );
  }
  return ctx;
}

/**
 * Rol de la persona EN LA EMPRESA ACTIVA. `null` si no hay empresa o no es
 * miembro de ninguna.
 *
 * Reemplaza a `(await currentRole())` en TODA decisión de permisos. La diferencia
 * no es de estilo: el rol de la sesión era global, así que una consultora que
 * atiende a dos laboratorios entraba como administradora en ambos aunque en uno
 * solo fuera agente. La sesión dice quién es la persona; qué puede hacer
 * depende de dónde está parada.
 *
 * Devuelve `null` en vez de lanzar porque casi todas las llamadas son de la
 * forma `if (!isAdminRole(await currentRole())) notFound()`: un `null` recorre
 * ese camino solo, mientras que una excepción daría error 500 donde
 * corresponde una pantalla de "no existe".
 */
export async function currentRole(): Promise<MembershipRole | null> {
  const ctx = await getTenantContext();
  return ctx?.role ?? null;
}

/**
 * Cliente de base de datos del inquilino activo.
 *
 * Reemplaza a `getDb()` en TODA lectura y escritura de negocio.
 */
export async function tenantDb() {
  const ctx = await requireTenant();
  // Personal de Astraion dentro de la empresa de un cliente: SOLO LECTURA, y
  // se decide aquí porque aquí pasa toda consulta de negocio. Un operador no
  // existe en `users`, así que ni siquiera podría firmar lo que escribiera —
  // las 33 columnas de negocio que registran quién hizo qué apuntan allí. Ver
  // la cabecera de `platformUsers`.
  return clientFor(ctx.schemaName, ctx.impersonated);
}

/** Para tareas fuera de una petición (cron, importadores): esquema explícito. */
export function tenantDbFor(schemaName: string) {
  return clientFor(schemaName);
}

/* ============================================================
   Bitácora de acceso de plataforma
   ============================================================ */

/**
 * Registra que alguien de la plataforma entró a la empresa de un cliente.
 *
 * No es opcional ni cosmético: un laboratorio farmacéutico va a preguntar quién
 * de tu equipo vio sus datos y cuándo, y la respuesta no puede ser "no lo
 * sabemos". Se escribe en `platform_events`, que sobrevive incluso si el
 * inquilino se da de baja y su esquema se elimina.
 */
export async function logTenantAccess(args: {
  tenantId: string;
  actorId: string;
  slug: string;
  reason?: string | null;
}) {
  const db = getDb();
  await db.insert(platformEvents).values({
    tenantId: args.tenantId,
    eventType: "tenant.accessed_by_platform",
    actorId: args.actorId,
    payload: { slug: args.slug, motivo: args.reason ?? null },
  });
}
