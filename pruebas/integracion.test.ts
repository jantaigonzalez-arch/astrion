/**
 * Las pruebas que hablan con la base.
 *
 *   npm run pruebas:base        una vez, para levantarla
 *   npm run test:integracion    cada vez que quieras correrlas
 *
 * Sin exportar nada: la URL se deriva del servidor de `.env.local` cambiándole
 * el nombre de la base por `evoelution_ci`. Ver `base.ts`.
 *
 * Aquí está lo que de verdad ejercita el producto de punta a punta: el ciclo de
 * vida de una factura de proveedor, el aislamiento entre empresas, a quién le
 * llega cada aviso, que borrar un entrenamiento no arrastre lo que no debe.
 *
 * ── LA BASE TIENE QUE ESTAR SEMBRADA ANTES ─────────────────────────────────
 *
 * Y se comprueba antes de correr nada. Sin esa comprobación, una base a medio
 * levantar produce trece fallos que parecen trece defectos del código y son un
 * solo problema de preparación — media hora persiguiendo el error equivocado.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { INTEGRACION } from "./registro";
import { correr, resumenDeFallo, RAIZ } from "./probes";
import { urlDePruebas } from "./base";
import { execFileSync } from "node:child_process";

beforeAll(() => {
  /*
    No hace falta exportar nada: la URL se deriva del servidor de `.env.local`
    cambiándole el nombre de la base por `evoelution_ci`. Ver `base.ts` — el
    servidor se hereda, el destino nunca, así que esto no puede acabar
    escribiendo en la copia de producción.
  */
  const url = urlDePruebas();
  if (!url) {
    throw new Error(
      "No pude averiguar contra qué base correr.\n\n" +
        "Normalmente sale de `.env.local`. Si no lo tenés, poné la URL a mano:\n" +
        "  DATABASE_URL=postgresql://…/evoelution_ci npm run test:integracion\n",
    );
  }
  // Los probes corren en su propio proceso y la leen del entorno.
  process.env.DATABASE_URL = url;

  /*
    Que la base exista no basta: tiene que estar SEMBRADA.

    Se comprueba con el inquilino y sus tickets, que es lo que casi todos estos
    probes leen. Una base migrada pero vacía los haría fallar a todos con
    mensajes sobre el negocio, escondiendo que lo que faltó fue la siembra.
  */
  const LEVANTALA =
    "\n\nLevantala con:\n\n" +
    "  npm run pruebas:base\n\n" +
    "Crea la base desde cero, aprovisiona tres empresas y siembra diez años de\n" +
    "historia sintética. Tarda cosa de un minuto y no toca tus datos reales.\n";

  let cuenta = "";
  try {
    cuenta = execFileSync(
      "psql",
      [url, "-tAc", "select count(*) from tenant_evoelution.tickets"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (e) {
    /*
      Aquí se cae cuando la base no existe todavía, y psql lo dice con un
      «FATAL: database … does not exist» que no sugiere qué hacer. Se traduce,
      porque este es el primer error que ve alguien que estrena el repositorio y
      merece salir de él con un comando y no con una búsqueda.
    */
    const detalle = String((e as { stderr?: string }).stderr ?? "").trim();
    throw new Error(`No pude leer la base de pruebas (${url}).${LEVANTALA}\n${detalle}`);
  }

  if (Number(cuenta) < 100) {
    throw new Error(`La base de pruebas está vacía (${cuenta} tickets).${LEVANTALA}`);
  }
});

describe("contra la base sembrada", () => {
  for (const archivo of INTEGRACION) {
    it(
      archivo,
      () => {
        const r = correr(archivo);
        expect(r.ok, resumenDeFallo(r)).toBe(true);
      },
      300_000,
    );
  }
});
