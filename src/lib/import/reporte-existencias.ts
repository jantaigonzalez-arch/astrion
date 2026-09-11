/**
 * Lector del reporte «Existencias y costos actuales» que exporta el ERP
 * anterior, pasado de .xlsx a CSV.
 *
 * NO es una tabla: son las páginas impresas del reporte. Cada hoja repite el
 * membrete, la fila de títulos y un pie con el usuario y el número de página, y
 * al final vienen los totales. Por eso se lee por TIPO DE FILA y no por la
 * primera línea, y por eso se lee con `parseCsvFilas`.
 *
 * ── LAS COLUMNAS SE MUEVEN ENTRE PÁGINAS ───────────────────────────────────
 *
 * Medido sobre el archivo real: la descripción cae en la columna 2 en unas
 * páginas y en la 3 en otras, y el costo total en la 12, la 13 o la 14 según lo
 * ancho que sea el número. Una posición fija leía mal 3 000 filas. Así que las
 * columnas salen de la fila de títulos MÁS RECIENTE, y la descripción y el total
 * son «la celda con algo» dentro de su tramo.
 *
 * ── SE CUADRA CONTRA SU PROPIO PIE, O NO SE CARGA ──────────────────────────
 *
 * El reporte trae al final cuántos registros son y cuánto suman existencia y
 * costo. `cuadrar` exige que lo leído dé lo mismo. Es lo que atrapa un lector
 * que se salta filas en silencio: el costo total, por ejemplo, no cuadraba por
 * una cifra de siete dígitos hasta que se vio que en una fila el número no cabía
 * y caía una columna a la izquierda.
 */
import { parseCsvMoney } from "./csv";

export type ProductoReporte = {
  /** Número de fila en el CSV (desde 1), para poder ir a buscarla. */
  fila: number;
  /** Normalizado: sin espacios al borde, sin apóstrofo inicial, en mayúsculas. */
  codigo: string;
  codigoOriginal: string;
  descripcion: string;
  costeo: string;
  /** `YYYY-MM-DD`, o null si el producto nunca se compró. */
  ultimaCompra: string | null;
  ultimoCosto: number | null;
  costoPromedio: number | null;
  existencia: number;
  costoTotal: number | null;
};

export type Incidencia = {
  fila: number | null;
  codigo: string | null;
  tipo: string;
  detalle: string;
};

export type ReporteExistencias = {
  productos: ProductoReporte[];
  pie: {
    registros: number | null;
    existencia: number | null;
    costoTotal: number | null;
  };
  /** «Pesos», tal como lo dice el reporte. */
  moneda: string | null;
  tipoDeCambio: number | null;
  /** Cuándo se sacó, tal como lo imprime el pie: `dd/mm/aaaa hh:mm`. */
  fechaHora: string | null;
  incidencias: Incidencia[];
};

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

/** `15/Ene/2020` → `2020-01-15`. Lo que no tenga esa forma, null. */
export function fechaDelReporte(v: string): string | null {
  const m = /^(\d{1,2})\/([A-Za-zÁÉÍÓÚáéíóú]{3})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  const d = Number(m[1]);
  const y = Number(m[3]);
  if (!mes) return null;
  const t = new Date(Date.UTC(y, mes - 1, d));
  if (t.getUTCMonth() !== mes - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

const ENTERO = /^-?\d{1,3}(,\d{3})*(\.0+)?$|^-?\d+(\.0+)?$/;
const NUMERO = /^-?[\d,]+(\.\d+)?$/;

/** Filas que tienen algo en la columna del código y NO son un producto. */
const ETIQUETAS = [/^Producto$/, /^Productos:$/, /^Proveedores:$/, /^Usuario$/, /^Total de registros/, /^Los montos/];

type Columnas = {
  producto: number;
  costeo: number;
  ultCompra: number;
  ultCosto: number;
  promedio: number;
  existencia: number;
};

function columnasDe(fila: string[]): Columnas | null {
  const i = (re: RegExp) => fila.findIndex((c) => re.test(c.trim()));
  const c = {
    producto: i(/^Producto$/),
    costeo: i(/^Costeo$/),
    ultCompra: i(/^Últ\.?\s*Comp/),
    ultCosto: i(/^Últ\.?\s*Costo/),
    promedio: i(/^Costo prom/),
    existencia: i(/^Existencia$/),
  };
  return Object.values(c).every((n) => n >= 0) ? c : null;
}

export function leerReporteExistencias(filas: string[][]): ReporteExistencias {
  const out: ReporteExistencias = {
    productos: [],
    pie: { registros: null, existencia: null, costoTotal: null },
    moneda: null,
    tipoDeCambio: null,
    fechaHora: null,
    incidencias: [],
  };
  let cols: Columnas | null = null;

  filas.forEach((cruda, k) => {
    const fila = k + 1;
    const r = cruda.map((c) => c ?? "");
    const texto = r.join(" ");

    const moneda = /expresados en:\s*(\S+).*tipo de cambio:\s*([\d.]+)/i.exec(texto);
    if (moneda) {
      out.moneda = moneda[1];
      out.tipoDeCambio = Number(moneda[2]);
      return;
    }
    const fecha = /(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2})/.exec(texto);
    if (fecha && /Usuario/.test(texto)) {
      out.fechaHora = fecha[1].replace(/\s+/g, " ");
      return;
    }
    if (r.some((c) => /^Total de registros/.test(c.trim()))) {
      // «Total de registros impresos: <n> … Total: <piezas> … <costo total>»
      const numeros = r.map((c) => c.trim()).filter((c) => NUMERO.test(c));
      out.pie.registros = parseCsvMoney(numeros[0] ?? "");
      out.pie.existencia = parseCsvMoney(numeros[1] ?? "");
      out.pie.costoTotal = parseCsvMoney(numeros[2] ?? "");
      return;
    }
    const titulos = columnasDe(r);
    if (titulos) {
      cols = titulos;
      return;
    }
    if (!cols) return; // membrete antes de la primera fila de títulos

    const original = (r[cols.producto] ?? "").trim();
    if (!original || ETIQUETAS.some((re) => re.test(original))) return;

    const exist = (r[cols.existencia] ?? "").trim();
    const costeo = (r[cols.costeo] ?? "").trim();
    if (!costeo || !NUMERO.test(exist)) {
      out.incidencias.push({
        fila,
        codigo: original,
        tipo: "fila no reconocida",
        detalle: "tiene algo en la columna del código pero no la forma de un producto; no se carga",
      });
      return;
    }

    // La descripción y el total son «lo que haya» en su tramo: ver arriba.
    const tramo = (desde: number, hasta: number) =>
      r.slice(desde, hasta).map((c) => c.trim()).filter(Boolean);
    const descripcion = tramo(cols.producto + 1, cols.costeo)[0] ?? "";
    const total = tramo(cols.existencia + 1, r.length).at(-1) ?? "";

    let codigo = original;
    if (codigo.startsWith("'")) {
      codigo = codigo.slice(1).trim();
      out.incidencias.push({
        fila,
        codigo,
        tipo: "código con apóstrofo",
        detalle: `venía como «${original}»; se cargó sin el apóstrofo`,
      });
    }

    let existencia = parseCsvMoney(exist) ?? 0;
    if (!ENTERO.test(exist)) {
      out.incidencias.push({
        fila,
        codigo,
        tipo: "existencia no entera",
        detalle: `el reporte dice ${exist} y el inventario cuenta piezas; se carga sin existencia`,
      });
      existencia = 0;
    }

    const compra = (r[cols.ultCompra] ?? "").trim();
    const ultimaCompra = compra ? fechaDelReporte(compra) : null;
    if (compra && !ultimaCompra) {
      out.incidencias.push({
        fila,
        codigo,
        tipo: "fecha no reconocida",
        detalle: `última compra «${compra}»`,
      });
    }

    out.productos.push({
      fila,
      codigo: codigo.toUpperCase(),
      codigoOriginal: original,
      descripcion,
      costeo,
      ultimaCompra,
      ultimoCosto: parseCsvMoney(r[cols.ultCosto] ?? ""),
      costoPromedio: parseCsvMoney(r[cols.promedio] ?? ""),
      existencia,
      costoTotal: parseCsvMoney(total),
    });
  });

  return out;
}

/**
 * Lo que impide cargar el reporte. Vacío = cuadra.
 *
 * Son errores y no avisos: si lo leído no da lo que el propio reporte dice que
 * contiene, el lector está equivocado en algo, y cargar así es cargar un
 * inventario que no suma.
 */
export function cuadrar(rep: ReporteExistencias): string[] {
  const errores: string[] = [];
  const { pie, productos } = rep;
  if (pie.registros === null) {
    errores.push("no se encontró el pie «Total de registros»: el archivo parece incompleto");
  } else if (pie.registros !== productos.length) {
    errores.push(`el pie dice ${pie.registros} registros y se leyeron ${productos.length}`);
  }
  const existencia = productos.reduce((s, p) => s + p.existencia, 0);
  if (pie.existencia !== null && pie.existencia !== existencia) {
    errores.push(`el pie suma ${pie.existencia} piezas y se leyeron ${existencia}`);
  }
  const total = productos.reduce((s, p) => s + (p.costoTotal ?? 0), 0);
  // Tolerancia de un peso: cada fila viene redondeada a centavos y el pie se
  // calcula sin redondear. Un error de lectura se va a miles, no a centavos.
  if (pie.costoTotal !== null && Math.abs(pie.costoTotal - total) > 1) {
    errores.push(
      `el costo total leído no cuadra con el pie (diferencia de ${(total - pie.costoTotal).toFixed(2)})`,
    );
  }
  if (!rep.moneda || !/^pesos/i.test(rep.moneda) || rep.tipoDeCambio !== 1) {
    errores.push(
      `los importes vienen en «${rep.moneda ?? "?"}» con tipo de cambio ${rep.tipoDeCambio ?? "?"}: ` +
        "el inventario guarda el costo en pesos y no se convierte a ciegas",
    );
  }
  return errores;
}

export type ParteConsolidada = {
  codigo: string;
  descripcion: string;
  /** Costo promedio en pesos con dos decimales; null si el reporte dice 0. */
  costoMxn: string | null;
  existencia: number;
  /** Las filas del reporte que la forman: una, o varias si el código se repite. */
  origen: ProductoReporte[];
};

/** Un largo que el ERP usa como tope de la descripción al imprimir. */
export const TOPE_DESCRIPCION_REPORTE = 40;

/**
 * Una refacción por código.
 *
 * `spare_parts.part_number` es único y el reporte trae códigos repetidos: el
 * ERP anterior tiene dos registros con el mismo código (23 en el archivo real,
 * comprobado sobre la celda cruda: el texto es idéntico, no hay un espacio ni
 * un carácter invisible que los distinga). No se puede saber cuál es «el
 * bueno», así que se hace lo que conserva las piezas y se deja dicho:
 *
 *  · idénticos en todo → uno solo. Sumarlos contaría dos veces lo mismo.
 *  · distintos → se SUMA la existencia (las piezas están en el almacén, estén
 *    en el registro que estén) y costo y descripción salen de la fila con más
 *    existencia; a igualdad, de la compra más reciente.
 *
 * Cada caso sale en las incidencias para que alguien lo revise.
 */
export function consolidar(productos: ProductoReporte[]): {
  partes: ParteConsolidada[];
  incidencias: Incidencia[];
} {
  const grupos = new Map<string, ProductoReporte[]>();
  for (const p of productos) {
    const g = grupos.get(p.codigo);
    if (g) g.push(p);
    else grupos.set(p.codigo, [p]);
  }
  const incidencias: Incidencia[] = [];
  const firma = (p: ProductoReporte) =>
    JSON.stringify([p.descripcion, p.ultimaCompra, p.ultimoCosto, p.costoPromedio, p.existencia]);

  const partes: ParteConsolidada[] = [];
  for (const [codigo, filas] of grupos) {
    const identicos = filas.every((p) => firma(p) === firma(filas[0]));
    const base = [...filas].sort(
      (a, b) =>
        b.existencia - a.existencia ||
        (b.ultimaCompra ?? "").localeCompare(a.ultimaCompra ?? ""),
    )[0];
    const existencia = identicos
      ? base.existencia
      : filas.reduce((s, p) => s + p.existencia, 0);

    if (filas.length > 1) {
      incidencias.push({
        fila: base.fila,
        codigo,
        tipo: identicos ? "código repetido, filas idénticas" : "código repetido con datos distintos",
        detalle: identicos
          ? `filas ${filas.map((p) => p.fila).join(", ")}: se cargó una sola vez`
          : `filas ${filas.map((p) => `${p.fila} (existencia ${p.existencia})`).join(", ")}: ` +
            `se sumó la existencia y el costo y la descripción salen de la fila ${base.fila}`,
      });
    }

    let descripcion = base.descripcion || filas.find((p) => p.descripcion)?.descripcion || "";
    if (!descripcion) {
      descripcion = "Sin descripción";
      incidencias.push({
        fila: base.fila,
        codigo,
        tipo: "sin descripción",
        detalle: "el reporte no trae descripción; se cargó como «Sin descripción»",
      });
    } else if (descripcion.length === TOPE_DESCRIPCION_REPORTE) {
      incidencias.push({
        fila: base.fila,
        codigo,
        tipo: "descripción posiblemente cortada",
        detalle: `mide justo ${TOPE_DESCRIPCION_REPORTE} caracteres, el tope con el que el ERP imprime; conviene completarla`,
      });
    }

    const costo = base.costoPromedio;
    if (existencia > 0 && !costo) {
      incidencias.push({
        fila: base.fila,
        codigo,
        tipo: "existencia sin costo",
        detalle: `hay ${existencia} pieza(s) y el costo promedio es 0: se cargan sin costo`,
      });
    }

    partes.push({
      codigo,
      descripcion,
      costoMxn: costo && costo > 0 ? costo.toFixed(2) : null,
      existencia,
      origen: filas,
    });
  }
  return { partes, incidencias };
}
