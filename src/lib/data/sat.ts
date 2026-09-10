import "server-only";
import { getDb } from "@/lib/db";
import {
  satCatalogo,
  satCodigoPostal,
  satRegimenFiscal,
  satUsoCfdi,
  satUsoRegimen,
} from "@/lib/db/platform";
import { eq } from "drizzle-orm";
import type { CatalogosSat } from "@/lib/domain/cliente";

/**
 * LOS CATÁLOGOS DEL SAT, TAL COMO ESTÁN HOY.
 *
 * ── `null` NO ES «VACÍO» ───────────────────────────────────────────────────
 *
 * Es la distinción que sostiene el módulo entero. Un catálogo sin cargar tiene
 * que devolver `null` para que `validarExpediente` conteste «no lo puedo
 * comprobar» en vez de «está mal». Si aquí se devolviera un `Map` vacío, un
 * régimen perfectamente válido saldría como inexistente y el sistema
 * rechazaría altas correctas con toda seguridad.
 *
 * Se lee del propio catálogo y no de una bandera de configuración: la pregunta
 * es «¿hay filas?», y la respuesta está en la tabla.
 *
 * ── SE LEEN DE `public`, SIN INQUILINO ─────────────────────────────────────
 *
 * `getDb()` y no `tenantDb()`. Estos catálogos son de la plataforma —los
 * publica el SAT para todo México— y viven una sola vez. Pedirlos por inquilino
 * daría la misma respuesta veinte veces.
 */
export async function getCatalogosSat(): Promise<CatalogosSat> {
  const db = getDb();

  const [regimenes, usos, pares] = await Promise.all([
    db.select().from(satRegimenFiscal),
    db.select().from(satUsoCfdi),
    db.select().from(satUsoRegimen),
  ]);

  /*
    El código postal NO se trae entero: son unos 95 000 renglones y no tiene
    sentido cargarlos en memoria para comprobar uno. Se pregunta por el que hace
    falta, y por eso el catálogo expone una función y no un conjunto.

    Se resuelve con una sola consulta por validación —la del CP que se está
    guardando—, que es lo que cuesta menos: índice de llave primaria.
  */
  const [{ filas: cpCargados } = { filas: 0 }] = await db
    .select({ filas: satCatalogo.filas })
    .from(satCatalogo)
    .where(eq(satCatalogo.nombre, "c_CodigoPostal"))
    .limit(1);

  const cpsConocidos = new Map<string, boolean>();

  return {
    regimenes: regimenes.length
      ? new Map(
          regimenes.map((r) => [
            r.clave,
            { aplicaFisica: r.aplicaFisica, aplicaMoral: r.aplicaMoral },
          ]),
        )
      : null,
    usos: usos.length
      ? new Map(
          usos.map((u) => [
            u.clave,
            { aplicaFisica: u.aplicaFisica, aplicaMoral: u.aplicaMoral },
          ]),
        )
      : null,
    usoRegimen: pares.length
      ? new Set(pares.map((p) => `${p.usoCfdi}|${p.regimenFiscal}`))
      : null,
    /*
      Sin catálogo cargado, `null`: no se puede comprobar y hay que decirlo.

      Con catálogo, la función consulta y memoiza. Es síncrona porque la firma
      del dominio lo es —y lo es a propósito: `validarExpediente` es puro y no
      debe poder tocar la base—, así que quien vaya a validar tiene que haber
      precargado el CP con `precargarCp()`. Suena incómodo y es deliberado:
      obliga a que la consulta ocurra donde se ve, no escondida dentro de una
      función que se anuncia como pura.
    */
    cpExiste: cpCargados > 0 ? (cp: string) => cpsConocidos.get(cp) ?? false : null,
  };
}

/**
 * Deja resuelto un código postal antes de validar.
 *
 * Existe porque `CatalogosSat.cpExiste` es síncrona: el dominio no puede —ni
 * debe— esperar a la base en mitad de una validación. Quien llama pregunta
 * primero por el CP que le interesa y luego valida.
 *
 * Devuelve los catálogos tal cual si `c_CodigoPostal` no está cargado: no hay
 * nada que precargar y la validación seguirá diciendo «no verificable».
 */
export async function precargarCp(
  catalogos: CatalogosSat,
  cp: string | null | undefined,
): Promise<CatalogosSat> {
  if (!catalogos.cpExiste || !cp) return catalogos;

  const db = getDb();
  const [fila] = await db
    .select({ cp: satCodigoPostal.cp })
    .from(satCodigoPostal)
    .where(eq(satCodigoPostal.cp, cp))
    .limit(1);

  const existe = Boolean(fila);
  return { ...catalogos, cpExiste: (otro: string) => (otro === cp ? existe : false) };
}

/** Las opciones que puede elegir un receptor de este tipo de persona. */
export async function getRegimenesPara(persona: "fisica" | "moral" | null) {
  const db = getDb();
  const filas = await db.select().from(satRegimenFiscal);
  return filas
    .filter((r) =>
      persona === "fisica" ? r.aplicaFisica : persona === "moral" ? r.aplicaMoral : true,
    )
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

/**
 * Los usos de CFDI compatibles con un régimen.
 *
 * Es lo que alimenta el selector filtrado, y es la diferencia entre evitar el
 * error CFDI40158 y provocarlo: mostrar los 24 usos y rechazar después es
 * programar un rechazo para dentro de tres pantallas.
 *
 * Con la matriz sin cargar devuelve TODOS los usos, no ninguno: sin ella no se
 * sabe cuáles son compatibles, y esconderlos todos dejaría el selector vacío
 * como si ninguno valiera.
 */
export async function getUsosPara(regimen: string | null) {
  const db = getDb();
  const usos = await db.select().from(satUsoCfdi);
  if (!regimen) return usos;

  const pares = await db
    .select()
    .from(satUsoRegimen)
    .where(eq(satUsoRegimen.regimenFiscal, regimen));

  if (pares.length === 0) return usos;
  const permitidos = new Set(pares.map((p) => p.usoCfdi));
  return usos.filter((u) => permitidos.has(u.clave));
}
