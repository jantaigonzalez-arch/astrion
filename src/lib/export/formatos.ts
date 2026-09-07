import "server-only";

/**
 * De filas a archivo: CSV y Excel, con los mismos datos y los mismos tipos.
 *
 * ── POR QUÉ DOS FORMATOS Y NO UNO ──────────────────────────────────────────
 *
 * CSV lo abre cualquier cosa —un script, Google Sheets, un ERP ajeno— y no pesa
 * nada. Excel conserva los TIPOS, y eso en un ERP mexicano no es un lujo: un
 * folio `0001234` en CSV entra a Excel como el número 1234 y pierde los ceros;
 * un RFC largo se convierte en notación científica; una fecha se reinterpreta
 * según la configuración regional de quien abre el archivo, así que 03/04 puede
 * ser marzo o abril según la máquina.
 *
 * Ninguno de esos tres estropicios se puede arreglar después: cuando alguien
 * abre el CSV, el dato ya se perdió. Por eso Excel es el que se ofrece primero
 * y CSV el que se elige a propósito.
 */

/** El tipo decide cómo viaja el dato, no cómo se ve. */
export type TipoColumna = "texto" | "numero" | "moneda" | "fecha" | "si-no";

export type Columna<T> = {
  titulo: string;
  tipo: TipoColumna;
  valor: (fila: T) => string | number | Date | boolean | null | undefined;
  /** Ancho en caracteres, solo para Excel. */
  ancho?: number;
};

/* ═══════════════════════════ CSV ═══════════════════════════ */

function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? diaISO(v) : String(v);
  // Comillas dobles, separadores y saltos de línea van entrecomillados. Sin
  // esto, una descripción con una coma parte la fila en dos columnas y todo lo
  // que sigue se corre — y el archivo se ve bien hasta que alguien suma mal.
  return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** `YYYY-MM-DD` en hora local, no UTC. Ver la nota de `diaCivil`. */
function diaISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function aCsv<T>(columnas: Columna<T>[], filas: T[]): Buffer {
  const cuerpo = [
    columnas.map((c) => celda(c.titulo)),
    ...filas.map((f) => columnas.map((c) => celda(c.valor(f)))),
  ]
    .map((r) => r.join(","))
    .join("\r\n");

  /*
    BOM al principio.

    Excel en Windows no detecta UTF-8 por sí solo: sin estos tres bytes, cada
    acento y cada ñ salen como caracteres rotos. Es un archivo perfectamente
    válido que la mitad de la oficina ve mal, y el usuario no tiene forma de
    saber que el problema es del programa que lo abre.
  */
  return Buffer.from("﻿" + cuerpo + "\r\n", "utf8");
}

/* ═══════════════════════════ Excel ═══════════════════════════ */

/**
 * A .xlsx de verdad.
 *
 * La librería se importa DENTRO de la función, no arriba del archivo. Es
 * deliberado: son 1,8 MB que solo hacen falta cuando alguien pulsa «descargar»,
 * y este módulo lo importa el registro de datasets, que a su vez lo importa
 * cualquier pantalla que enseñe el botón. Con el import arriba, el costo de
 * cargar Excel lo pagaría cada carga de cada listado del portal.
 */
export async function aExcel<T>(
  columnas: Columna<T>[],
  filas: T[],
  hoja: string,
): Promise<Buffer> {
  const { default: writeXlsx } = await import("write-excel-file/node");

  const cols = columnas.map((c) => ({
    header: c.titulo,
    width: c.ancho ?? anchoPara(c.tipo),
    cell: (fila: T) => celdaExcel(c, fila),
  }));

  /*
    El `as never` acota una incompatibilidad de TIPOS, no de comportamiento.

    La librería declara tres sobrecargas —filas sueltas, objetos con columnas, y
    varias hojas— y TypeScript elige la última al ver un genérico `T[]`, que es
    la que espera hojas. En tiempo de ejecución la biblioteca mira si el primer
    elemento es un objeto y toma el camino correcto; probado con 20 000 filas.
    Tiparlo bien exigiría atar `T` a la forma interna de la librería, que es
    justo lo que esta capa existe para no hacer.
  */
  const salida = await (writeXlsx as never as (
    f: T[],
    o: Record<string, unknown>,
  ) => Promise<{ toBuffer: () => Buffer }>)(filas, {
    columns: cols,
    // El nombre de la hoja se ve en la pestaña de abajo. Excel no admite más de
    // 31 caracteres ni los de `[]:*?/\`, y con uno inválido se niega a abrir el
    // archivo entero.
    sheet: hoja.replace(/[[\]:*?/\\]/g, " ").slice(0, 31),
    // Encabezado congelado: en una descarga de mil filas, sin esto se pierde de
    // vista qué columna es cuál en cuanto se hace scroll.
    stickyRowsCount: 1,
    buffer: true,
  });
  return salida.toBuffer();
}

function anchoPara(t: TipoColumna): number {
  return t === "fecha" ? 12 : t === "moneda" || t === "numero" ? 14 : 24;
}

function celdaExcel<T>(c: Columna<T>, fila: T) {
  const v = c.valor(fila);
  // Vacío es `undefined` y no `null`: la librería tipa `null` como valor no
  // admitido, y una celda sin valor es exactamente eso — ausencia, no un cero
  // ni una cadena vacía que después se sume o se ordene mal.
  if (v === null || v === undefined || v === "") return { value: undefined };

  switch (c.tipo) {
    case "numero":
      return { type: Number, value: Number(v), format: "#,##0.##" };
    case "moneda":
      // Formato de moneda de verdad, no un texto con `$` delante: así se puede
      // sumar la columna en la hoja, que es lo primero que hace quien descarga.
      return { type: Number, value: Number(v), format: '"$"#,##0.00' };
    case "fecha": {
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime())
        ? { type: String, value: String(v) }
        : { type: Date, value: d, format: "dd/mm/yyyy" };
    }
    case "si-no":
      return { type: String, value: v ? "Sí" : "No" };
    default:
      /*
        TEXTO, y aquí está la razón de que exista el tipo.

        Un folio `0001234` o un RFC como `AAA010101AAA` se meten como CADENA a
        propósito. Si se dejaran al criterio de Excel, el primero perdería los
        ceros y un RFC de puros dígitos acabaría en notación científica. Es el
        estropicio que el CSV no puede evitar y que este formato sí.
      */
      return { type: String, value: String(v) };
  }
}
