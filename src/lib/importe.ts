import { z } from "zod";

/**
 * IMPORTES TECLEADOS EN UN FORMULARIO.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * Siete acciones limpiaban el importe con `v.replace(/[^0-9.]/g, "")`: «quita
 * todo lo que no sea dígito o punto». Parece tolerante y es destructivo, de
 * dos maneras que nadie veía porque la respuesta era siempre «guardado»:
 *
 *   · se lleva el SIGNO. «-50» entraba como 50, y las comprobaciones de
 *     negativos que venían detrás no se cumplían nunca;
 *   · convierte el texto en VACÍO. «mil pesos» quedaba en "", que para un campo
 *     opcional es «sin importe»: el contrato se guardaba sin monto, y el tipo de
 *     cambio de la empresa se BORRABA por un error de dedo.
 *
 * Lo encontraron las pruebas de acciones (`scripts/_probe-acciones-*.ts`), la
 * primera vez que alguien le mandó basura a una.
 *
 * ── LO QUE SÍ SE TOLERA ────────────────────────────────────────────────────
 *
 * El formato con el que se escribe dinero: el símbolo `$`, las comas de miles,
 * los espacios y el código de moneda delante o detrás («MXN 1,250.50»). Nada
 * más: lo que quede tiene que ser un número, o no es un importe.
 *
 * El CSV del importador tiene su propia lectura (`parseCsvMoney`), que además
 * entiende los paréntesis contables; un formulario no los usa.
 */
export function limpiarImporte(v: string): string {
  return v
    .trim()
    .replace(/^(mxn|usd)\s*|\s*(mxn|usd)$/gi, "")
    .replace(/[$,\s]/g, "");
}

/**
 * El importe como número. `null` si el campo vino vacío, `NaN` si trae algo que
 * no es un número —distinguirlos es de quien llama: vacío puede ser válido, NaN
 * nunca—. Conserva el signo; si un negativo no vale, lo decide quien llama.
 */
export function leerImporte(v: FormDataEntryValue | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const s = limpiarImporte(v);
  return s === "" ? null : Number(s);
}

/**
 * Importe opcional y no negativo, como TEXTO listo para una columna `numeric`.
 *
 * Vacío es `undefined` —«sin importe», que es legítimo en un contrato o un
 * precio de lista—; cualquier otra cosa tiene que ser un número de cero en
 * adelante, o la validación falla y la acción responde «invalid».
 */
export const importeOpcional = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    return limpiarImporte(v) || undefined;
  })
  .refine((v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0), {
    message: "monto inválido",
  });
