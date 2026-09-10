import { soloEnPruebas } from "./_stub-guardia";

soloEnPruebas(
  "_stub-auth",
  "Fabrica sesiones sin contraseña: dentro de la aplicación, cualquiera\n" +
    "  entraría como quien dijera la variable de entorno.",
);

/**
 * Sustituto de `@/lib/auth` para los probes bajo la condición `react-server`.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * next-auth arrastra el `next/navigation` de cliente, que llama a
 * `createContext` — y esa función no existe en la versión `react-server` de
 * React, que es justamente la única donde `cache` memoiza. Cortar aquí es más
 * limpio que remendar la cadena entera.
 *
 * ── SIN SESIÓN POR OMISIÓN, Y ESO NO ES PEREZA ─────────────────────────────
 *
 * Devolvía `null` a secas, y para lo que existía entonces era lo correcto: los
 * probes medían CONSULTAS, y una sesión inventada solo servía para que algo
 * pasara por un camino que el probe no ejercitaba.
 *
 * Pero eso dejaba fuera una clase entera de pruebas. Las 137 acciones de
 * servidor abren TODAS con `if (!session?.user || !(await puedeEn(…)))`, así
 * que con `null` ninguna llega a tocar la base: devuelven «auth» y el probe
 * comprueba el portero, nunca la casa. Es la razón mecánica de que no hubiera
 * ni una prueba de acciones.
 *
 * Así que el valor por omisión SIGUE SIENDO `null` —los probes de siempre no
 * cambian de comportamiento por esto— y quien quiera ejercitar una acción pide
 * la sesión explícitamente por entorno:
 *
 *     PROBE_USER_ID=<uuid de un usuario de la base sembrada> \
 *       npx tsx --tsconfig tsconfig.probe.json … probe-loquesea.mts
 *
 * Explícito y no automático a propósito: que un probe corra CON sesión tiene
 * que ser una decisión visible en su invocación, porque cambia por completo lo
 * que está probando.
 */
import type { SessionKind, PlatformRole } from "@/lib/auth";

/*
  Se lee en CADA llamada y no una vez al cargar el módulo.

  Un probe de acciones necesita cambiar de identidad a mitad de camino —correr
  la misma acción como dos personas de dos empresas es justamente como se
  comprueba el aislamiento— y con la constante fijada al importar eso no se
  puede: la primera sesión que se pidiera sería la única del proceso.
*/

/**
 * La sesión, con la misma forma que declara `@/lib/auth`.
 *
 * `kind` es `tenant` porque lo que se ejercita son las acciones del portal de
 * una empresa. Un probe de la consola de Astraion tendría que pedir
 * `PROBE_USER_KIND=platform`, y por eso se lee del entorno en vez de fijarse:
 * el día que haga falta, el que lo necesite no tiene que tocar este archivo.
 */
type Sesion = {
  user: {
    id: string;
    kind: SessionKind;
    platformRole: PlatformRole;
    name?: string | null;
    email?: string | null;
  };
};

export async function auth(): Promise<Sesion | null> {
  const id = process.env.PROBE_USER_ID;
  if (!id) return null;
  return {
    user: {
      id,
      kind: (process.env.PROBE_USER_KIND as SessionKind) ?? "tenant",
      platformRole: (process.env.PROBE_PLATFORM_ROLE as PlatformRole) ?? null,
      name: process.env.PROBE_USER_NAME ?? "probe",
      email: process.env.PROBE_USER_EMAIL ?? "probe@example.test",
    },
  };
}
