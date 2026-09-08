/**
 * Las pruebas que hablan con la base.
 *
 *   scripts/base-de-pruebas.sh && npm run test:integracion
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
import { execFileSync } from "node:child_process";

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. Las pruebas de integración necesitan una base de " +
        "PRUEBAS levantada:\n\n" +
        "  DATABASE_URL=postgresql://…/evoelution_ci scripts/base-de-pruebas.sh\n",
    );
  }

  /*
    Que la base exista no basta: tiene que estar SEMBRADA.

    Se comprueba con el inquilino y sus tickets, que es lo que casi todos estos
    probes leen. Una base migrada pero vacía los haría fallar a todos con
    mensajes sobre el negocio, escondiendo que lo que faltó fue la siembra.
  */
  const cuenta = execFileSync(
    "psql",
    [url, "-tAc", "select count(*) from tenant_evoelution.tickets"],
    { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (Number(cuenta) < 100) {
    throw new Error(
      `La base de pruebas está vacía (${cuenta} tickets). Levántala con:\n\n` +
        "  DATABASE_URL=… scripts/base-de-pruebas.sh\n",
    );
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
