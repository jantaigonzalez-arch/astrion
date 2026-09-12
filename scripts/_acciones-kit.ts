/**
 * LO QUE COMPARTEN LAS PRUEBAS DE ACCIONES DE SERVIDOR.
 *
 * No es un probe —el nombre no empieza por `_probe-`, así que el registro no lo
 * busca—: es el andamio de los `scripts/_probe-acciones-*.ts`. Cada uno de esos
 * lo importa PRIMERO, antes que cualquier cosa de `@/lib`, y luego carga las
 * acciones con `await import(…)`.
 *
 * ── LO QUE SE COMPRUEBA DE CADA ACCIÓN, Y POR QUÉ ESO Y NO MÁS ────────────
 *
 * Lo que aporta la capa de acción y nada más, igual que `_probe-acciones`:
 *
 *   1. que la guardia rechace, y que al rechazar NO ESCRIBA;
 *   2. que pida el nivel CORRECTO —se le da un escalón menos y debe decir que
 *      no; un borrado que se conforme con «editar» es un hueco, no un detalle—;
 *   3. que una captura inválida se rechace sin dejar rastro;
 *   4. que el camino feliz escriba de verdad, firmado por quien tiene la sesión;
 *   5. que lo escrito caiga en la empresa de la sesión y en ninguna otra.
 *
 * Las reglas de negocio no se repiten aquí: las cubren los probes de dominio.
 *
 * ── LA BASE ES UN CANDADO, NO UNA PREFERENCIA ──────────────────────────────
 *
 * Estas pruebas escriben, borran y dan de alta empresas. `.env.local` apunta a
 * la copia de PRODUCCIÓN, con clientes reales, así que el kit no la lee: toma
 * la URL de `pruebas/base.ts` —el mismo servidor, la base `evoelution_ci`— y
 * se niega a arrancar si el nombre no termina en `_ci`, `_test` o `_pruebas`,
 * que es la misma regla con la que `base-de-pruebas.sh` se deja borrar.
 *
 * Por eso se corren sin exportar nada y sin miedo:
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
 *     scripts/_probe-acciones-<archivo>.ts
 *
 * ── LA VERIFICACIÓN NO PASA POR EL STUB ────────────────────────────────────
 *
 * `sql` es una conexión propia, sin `search_path`: cada consulta nombra su
 * esquema. Comprobar el efecto de una acción con la misma conexión que usó la
 * acción daría por buena justo la pieza bajo sospecha.
 */
import postgres from "postgres";
import { config } from "dotenv";
import { urlDePruebas } from "../pruebas/base";

/* ── 1 · La base ─────────────────────────────────────────────────────────── */

const URL_BASE = urlDePruebas();
if (!URL_BASE) {
  console.error(
    "✗ No pude averiguar la base de pruebas: no hay DATABASE_URL ni .env.local.",
  );
  process.exit(1);
}
const NOMBRE_BASE = new URL(URL_BASE).pathname.replace(/^\//, "");
if (!/_(ci|test|pruebas)$/.test(NOMBRE_BASE)) {
  console.error(
    `✗ Me niego a correr contra «${NOMBRE_BASE}».\n\n` +
      "  Estas pruebas ejercitan acciones que escriben y borran. Solo corren\n" +
      "  contra una base cuyo nombre termine en _ci, _test o _pruebas.\n" +
      "  Levantá la de pruebas con: npm run pruebas:base\n",
  );
  process.exit(1);
}
/*
  Se fija ANTES de que nada cargue `@/lib/db`, que lee la variable una sola vez
  al importarse. Y el resto de `.env.local` se carga DESPUÉS: dotenv no pisa lo
  que ya está, así que la base se queda en la de pruebas. Por eso los probes de
  acciones no importan `./_env`.
*/
process.env.DATABASE_URL = URL_BASE;
/*
  Y el correo, a la consola, pase lo que pase en `.env.local`. Media docena de
  acciones avisan por correo —un ticket nuevo, un viático por autorizar— y una
  prueba no tiene derecho a escribirle a nadie. Se fija antes de cargar el
  archivo por lo mismo que la base: dotenv no pisa lo que ya está.
*/
process.env.MAIL_PROVIDER = "consola";
process.env.RESEND_API_KEY = "";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

/* ── 2 · Dónde y con quién ───────────────────────────────────────────────── */

/** La empresa de la sesión. El stub de inquilino lee lo mismo. */
export const ESQUEMA = process.env.PROBE_SCHEMA ?? "tenant_evoelution";
process.env.PROBE_SCHEMA = ESQUEMA;
/** Otra empresa de la base sembrada, para medir el aislamiento contra algo. */
export const AJENO = process.env.PROBE_SCHEMA_AJENO ?? "tenant_acme";

/** Marca única de esta corrida: todo lo que se escriba la lleva, para limpiar. */
export function marca(prefijo: string): string {
  return `${prefijo}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

/** Conexión de verificación. Sin `search_path`: el esquema va escrito. */
export const sql = postgres(URL_BASE, { max: 2, prepare: false, onnotice: () => {} });

/** Filas de una consulta cruda, ya tipadas como objetos planos. */
export async function filas<T = Record<string, unknown>>(q: string): Promise<T[]> {
  return (await sql.unsafe(q)) as unknown as T[];
}

/** Cuántas filas cumplen `filtro` en `esquema.tabla`. */
export async function cuantos(
  tabla: string,
  filtro = "",
  esquema = ESQUEMA,
): Promise<number> {
  const [r] = await filas<{ n: number }>(
    `select count(*)::int as n from ${esquema}.${tabla} ${filtro}`,
  );
  return Number(r?.n ?? 0);
}

/**
 * Una foto del estado, para comparar antes y después de una acción rechazada.
 *
 * Cada entrada es un nombre de tabla —se cuenta— o un `select` completo —se
 * serializa—. El conteo basta para altas y bajas; para una acción que
 * ACTUALIZA hay que pasar el `select` de la fila, porque un `update` no mueve
 * ningún conteo y la prueba daría verde con la fila cambiada.
 */
export async function foto(...que: string[]): Promise<string> {
  const partes: string[] = [];
  for (const q of que) {
    if (/^\s*select\b/i.test(q)) partes.push(JSON.stringify(await filas(q)));
    else partes.push(`${q}=${await cuantos(q)}`);
  }
  return partes.join(" | ");
}

/** Un usuario con membresía en la empresa de la sesión (el «actor»). */
export async function usuarioDeLaEmpresa(rol?: string): Promise<string | null> {
  const slug = ESQUEMA.replace(/^tenant_/, "");
  const [u] = await filas<{ id: string }>(
    `select u.id from users u
       join memberships m on m.user_id = u.id
       join tenants t on t.id = m.tenant_id
      where t.slug = '${slug}' ${rol ? `and m.role = '${rol}'` : ""}
        and m.active and u.active
      order by u.created_at nulls last, u.id
      limit 1`,
  );
  return u?.id ?? null;
}

/**
 * Cambia de identidad. Lo leen los stubs en CADA llamada.
 *
 *   como(null)                               sin sesión
 *   como(ACTOR, false)                       sesión, todo denegado
 *   como(ACTOR, "ventas:editar")             sesión, hasta ese nivel
 *   como(ACTOR)                              sesión, todo concedido
 *   como(ACTOR, true, { rol: "agent" })      y además con ese rol
 */
export function como(
  usuario: string | null,
  puede: boolean | string = true,
  extra: { rol?: string; plataforma?: string | null } = {},
): void {
  if (usuario) process.env.PROBE_USER_ID = usuario;
  else delete process.env.PROBE_USER_ID;
  process.env.PROBE_PUEDE = String(puede);
  if (extra.rol) process.env.PROBE_ROL = extra.rol;
  else delete process.env.PROBE_ROL;
  if (extra.plataforma) {
    process.env.PROBE_USER_KIND = "platform";
    process.env.PROBE_PLATFORM_ROLE = extra.plataforma;
  } else {
    delete process.env.PROBE_USER_KIND;
    delete process.env.PROBE_PLATFORM_ROLE;
  }
}

/** FormData a partir de un objeto, que es como llegan de un `<form>`. */
export function forma(
  campos: Record<string, string | string[] | undefined | null>,
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) fd.append(k, x);
    else fd.set(k, v);
  }
  return fd;
}

/* ── 3 · El veredicto ───────────────────────────────────────────────────── */

let fallos = 0;

export function ok(etiqueta: string, cond: boolean, extra = ""): boolean {
  if (!cond) fallos++;
  console.log(`${cond ? "✓" : "✗"} ${etiqueta}${extra ? ` — ${extra}` : ""}`);
  return cond;
}

export function seccion(titulo: string): void {
  console.log(`\n${titulo.toUpperCase()}`);
}

/**
 * Corre una acción y dice cómo terminó, sin dejar que un lanzamiento tumbe el
 * probe.
 *
 * `redirige` es el destino si la acción terminó redirigiendo —en Next eso es
 * lanzar, y aquí el stub lanza `RedireccionDeProbe` con el destino—; `error`,
 * el mensaje si reventó por otra cosa. Separarlos importa: una redirección es
 * el final feliz de varias acciones, y confundirla con un fallo pondría rojo
 * justo el camino que funciona.
 */
export async function intentar<T>(
  fn: () => Promise<T>,
): Promise<{ valor?: T; redirige?: string; error?: string }> {
  try {
    return { valor: await fn() };
  } catch (e) {
    const destino = (e as { destino?: unknown })?.destino;
    if (typeof destino === "string") return { redirige: destino };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * La comprobación que más se repite: la acción se rechaza y no escribe nada.
 *
 * `antes` es la `foto()` tomada ANTES de llamar; se compara con otra tomada
 * después. `rechazo` decide si el resultado cuenta como rechazo: por omisión,
 * `{ ok: false }`, `undefined` (las acciones de `void` que vuelven sin hacer
 * nada) o una lista vacía. Pasale una función más estricta cuando la acción
 * devuelva un mensaje propio de la guardia: comparar el mensaje es lo que ata
 * la comprobación a SU camino —si la guardia deja pasar, el error que vuelve es
 * otro y se ve—.
 */
export async function rechazaSinEscribir<T>(
  etiqueta: string,
  fn: () => Promise<T>,
  que: string[],
  rechazo: (r: T | undefined) => boolean = rechazoPorOmision,
): Promise<void> {
  const antes = await foto(...que);
  const r = await intentar(fn);
  const despues = await foto(...que);
  const rechazada = r.error === undefined && r.redirige === undefined && rechazo(r.valor);
  ok(
    `${etiqueta}: rechazada`,
    rechazada,
    r.error
      ? `reventó: ${r.error.slice(0, 80)}`
      : r.redirige
        ? `redirigió a ${r.redirige}`
        : rechazada
          ? ""
          : `devolvió ${JSON.stringify(r.valor)?.slice(0, 80)}`,
  );
  ok(`${etiqueta}: y no escribió`, antes === despues, antes === despues ? "" : `${antes} → ${despues}`);
}

function rechazoPorOmision(r: unknown): boolean {
  if (r === undefined || r === null) return true;
  if (Array.isArray(r)) return r.length === 0;
  if (typeof r === "object" && "ok" in (r as object)) return (r as { ok: unknown }).ok === false;
  return false;
}

/** `{ ok: false, error: <mensaje> }` exacto: rechazada por ESA guardia. */
export const conError =
  (mensaje: string) =>
  (r: unknown): boolean =>
    typeof r === "object" &&
    r !== null &&
    (r as { ok?: unknown }).ok === false &&
    (r as { error?: unknown }).error === mensaje;

/* ── 4 · Limpieza y final ───────────────────────────────────────────────── */

const limpiezas: Array<() => Promise<unknown>> = [];

/**
 * Registra algo que deshacer al final, pase lo que pase. Se ejecutan en orden
 * INVERSO —lo último que se creó es lo primero que se borra, que es el orden
 * que respetan las llaves foráneas— y un fallo en una no impide las demás.
 */
export function alLimpiar(fn: () => Promise<unknown>): void {
  limpiezas.push(fn);
}

/** Atajo: `delete from ESQUEMA.tabla where …` al final. */
export function borrarAlFinal(tabla: string, filtro: string, esquema = ESQUEMA): void {
  alLimpiar(() => sql.unsafe(`delete from ${esquema}.${tabla} where ${filtro}`));
}

/**
 * El cuerpo del probe, con la limpieza en el `finally` y el código de salida
 * según las comprobaciones. Un probe que revienta a mitad sale con 1 aunque no
 * haya imprimido ni un `✗`: es el fallo que más importa ver.
 */
export async function probar(titulo: string, cuerpo: () => Promise<void>): Promise<never> {
  let reventon: unknown = null;
  try {
    await cuerpo();
  } catch (e) {
    reventon = e;
  } finally {
    for (const fn of limpiezas.reverse()) {
      await fn().catch((e) => console.log(`· limpieza falló: ${String(e).slice(0, 120)}`));
    }
    console.log("— limpieza hecha");
    await sql.end({ timeout: 5 });
  }
  if (reventon) {
    console.error("\n✗ el probe reventó:", reventon);
    process.exit(1);
  }
  console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron\n` : `\n✅ ${titulo}\n`);
  process.exit(fallos ? 1 : 0);
}
