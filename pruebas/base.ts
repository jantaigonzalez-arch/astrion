/**
 * A QUÉ BASE APUNTAN LAS PRUEBAS DE INTEGRACIÓN.
 *
 * ── POR QUÉ NO SE LEE `.env.local` Y YA ────────────────────────────────────
 *
 * Porque en esta máquina `.env.local` apunta a una copia de PRODUCCIÓN, con 161
 * organizaciones reales y sus contratos. Las pruebas de integración escriben:
 * dan de alta tickets, firman viáticos, borran entrenamientos. Cogerla de ahí
 * sería la forma más rápida de estropear una sincronización entera, y `sync:prod`
 * va en un solo sentido — no hay desde dónde recuperarla.
 *
 * ── LO QUE SÍ SE HACE ──────────────────────────────────────────────────────
 *
 * Se toma el SERVIDOR de `.env.local` —usuario, contraseña, puerto: lo que ya
 * funciona en tu máquina— y se le cambia el nombre de la base por `evoelution_ci`.
 * El servidor se hereda, el destino nunca. Así no hay que exportar nada para
 * correr las pruebas, y aun así es imposible que acaben apuntando a los datos de
 * un cliente.
 *
 * En CI no interviene: allí `DATABASE_URL` viene del propio flujo y manda.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RAIZ } from "./probes";

/** El nombre es un candado: `base-de-pruebas.sh` solo borra bases así llamadas. */
export const BASE_DE_PRUEBAS = "evoelution_ci";

/**
 * La URL contra la que corren las pruebas de integración.
 *
 * `DATABASE_URL` gana si está puesta —es como lo hace el CI, y como se apunta a
 * otro servidor a mano—. Si no, se deriva de `.env.local`.
 */
export function urlDePruebas(): string | null {
  const delEntorno = process.env.DATABASE_URL;
  if (delEntorno) return delEntorno;

  const env = path.join(RAIZ, ".env.local");
  if (!existsSync(env)) return null;

  const m = readFileSync(env, "utf8").match(/postgres(?:ql)?:\/\/[^\s"']+/);
  if (!m) return null;

  /*
    Se reemplaza el ÚLTIMO segmento, que es el nombre de la base.

    Con `replace` sobre el nombre viejo bastaría casi siempre y fallaría justo
    cuando duele: un usuario que se llame igual que la base —`evoelution`, que
    es el caso de esta máquina— haría que se cambiara el usuario en vez del
    destino, y la URL resultante apuntaría a la copia de producción con un
    usuario que no existe. Cortar por la última barra no tiene ese problema.
  */
  const url = m[0];
  const corte = url.lastIndexOf("/");
  if (corte < 0) return null;
  const query = url.slice(corte).includes("?") ? url.slice(url.indexOf("?", corte)) : "";
  return `${url.slice(0, corte)}/${BASE_DE_PRUEBAS}${query}`;
}
