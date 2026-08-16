/**
 * Lectura de CSV.
 *
 * Vivía dentro de `scripts/import-legacy.ts`, escrita para migrar el sistema
 * anterior y probada contra sus cuatro archivos reales. Se sacó aquí sin
 * cambiarla cuando la importación de cuentas por pagar necesitó lo mismo: el
 * script la importa de este módulo, no hay dos copias.
 *
 * No usa una librería a propósito. Lo que hace falta —comillas dobles, saltos
 * de línea embebidos, BOM de Excel— cabe en treinta líneas, y una dependencia
 * más en el servidor para eso no se paga sola.
 */

/** CSV con comillas dobles, saltos de línea embebidos y BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!head) return [];
  return body.map((r) =>
    Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])),
  );
}

/**
 * Normaliza un nombre para cruzarlo entre archivos: mayúsculas, sin acentos,
 * sin puntuación y con los espacios colapsados.
 *
 * Se usa para resolver un proveedor cuando el archivo no trae RFC. «S.A. de
 * C.V.» y «SA DE CV» tienen que caer en la misma llave o el mismo proveedor
 * entra dos veces.
 */
export function normName(s: string): string {
  return (s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fecha de un CSV a `YYYY-MM-DD`.
 *
 * Acepta ISO y `dd/mm/yyyy`. El orden latino y no el estadounidense porque
 * estos archivos los exporta un ERP mexicano; cuando el primer campo pasa de
 * 12 no hay ambigüedad y se corrige solo, pero `03/04/2026` se lee como 3 de
 * abril. Es una decisión, no una suposición: queda dicha aquí para que quien
 * importe archivos de otro origen sepa qué está asumiendo.
 */
export function parseCsvDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return armarFecha(Number(y), Number(m), Number(d));
  }

  const lat = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (lat) {
    let [, d, m] = lat;
    const y = lat[3];
    // Si el primer campo pasa de 12 solo puede ser el día; si el segundo pasa
    // de 12 el archivo viene en mm/dd y se invierte.
    if (Number(m) > 12 && Number(d) <= 12) [d, m] = [m, d];
    return armarFecha(Number(y), Number(m), Number(d));
  }

  return null;
}

function armarFecha(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    return null;
  }
  // Comprobación real del calendario: 31/02 tiene forma válida y no existe.
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/**
 * Importe de un CSV.
 *
 * Devuelve `null` si no hay número, y NO cero: un importe vacío y un importe de
 * cero son cosas distintas, y confundirlos crea facturas de cero que hay que
 * ir a borrar a mano. Acepta el separador de miles y el símbolo de moneda.
 */
export function parseCsvMoney(v: string): number | null {
  const s = (v || "").trim();
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith("-");
  const limpio = s.replace(/[^0-9.]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}
