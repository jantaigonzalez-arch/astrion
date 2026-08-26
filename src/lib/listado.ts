/**
 * Ordenar y filtrar un listado desde la URL.
 *
 * Hermano de `pagination.ts`, y existe por la misma razón que aquél: el orden y
 * los filtros llegan por la dirección, o sea desde fuera, y hay exactamente un
 * sitio donde ese texto ajeno deja de serlo. Aquí.
 *
 * ── POR QUÉ EN LA URL Y NO EN EL ESTADO DEL COMPONENTE ─────────────────────
 *
 * Porque un listado ordenado y filtrado es una VISTA, y una vista se comparte:
 * «mirá los tickets críticos sin asignar» tiene que poder pegarse en un
 * mensaje. Con el estado en el cliente, ese enlace lleva a la lista sin filtrar
 * y quien lo recibe no ve de qué le hablan. Además sobrevive a la recarga y al
 * botón de atrás, que es lo que el navegador ya sabe hacer.
 *
 * ── POR QUÉ EL ORDEN SE APLICA EN LA BASE Y NO EN LA PÁGINA ────────────────
 *
 * Es la regla que no se puede romper en un listado paginado. Ordenar en el
 * cliente ordena LAS 25 FILAS QUE SE VEN, no las 633 que hay: la columna
 * «prioridad» quedaría ordenada dentro de la página y el ticket más crítico
 * seguiría escondido en la página nueve. Y el usuario no tiene forma de
 * saberlo, porque la tabla se ve perfectamente ordenada.
 *
 * Por eso `parseOrden` devuelve una llave de un catálogo CERRADO, que quien
 * consulta traduce a una columna real. Nada de lo que venga en la URL llega a
 * un `order by`.
 */

export type Direccion = "asc" | "desc";

export type Orden<K extends string = string> = {
  campo: K;
  dir: Direccion;
};

/**
 * El orden pedido, si es uno de los permitidos.
 *
 * Cualquier otra cosa cae al orden por omisión sin avisar, igual que `parsePage`
 * con `?page=abc`: una URL manipulada no merece una pantalla de error, merece
 * el comportamiento normal.
 *
 * `permitidos` es la lista blanca y es lo único que impide que `?orden=` acabe
 * decidiendo por qué columna se ordena. No es paranoia teórica: quien llama
 * traduce esa llave a una columna de la tabla, y una llave libre sería un
 * `order by` escrito desde la barra de direcciones.
 */
export function parseOrden<K extends string>(
  searchParams: { orden?: string; dir?: string } | undefined,
  permitidos: readonly K[],
  porDefecto: Orden<K>,
): Orden<K> {
  const campo = searchParams?.orden as K | undefined;
  if (!campo || !permitidos.includes(campo)) return porDefecto;
  const dir: Direccion = searchParams?.dir === "asc" ? "asc" : "desc";
  return { campo, dir };
}

/**
 * El valor de un filtro, si es uno de los que existen.
 *
 * Devuelve `undefined` cuando no hay filtro o cuando el valor no está en la
 * lista: las dos cosas significan lo mismo para quien consulta —no filtres— y
 * distinguirlas obligaría a cada pantalla a decidir qué hacer con un valor
 * inventado.
 */
export function parseFiltro<V extends string>(
  valor: string | undefined,
  permitidos: readonly V[],
): V | undefined {
  if (!valor) return undefined;
  return permitidos.includes(valor as V) ? (valor as V) : undefined;
}

/**
 * La dirección de arranque de cada tipo de columna.
 *
 * Una fecha se mira primero por lo más reciente y un nombre por la A. Clavar
 * `asc` para todo obliga a dos clics para ver lo último, que es lo que casi
 * siempre se busca al ordenar por fecha.
 */
export const INICIAL: Record<"texto" | "fecha" | "numero", Direccion> = {
  texto: "asc",
  fecha: "desc",
  numero: "desc",
};

/**
 * A dónde lleva pulsar el encabezado de una columna.
 *
 * Si ya se está ordenando por ella, invierte la dirección; si no, arranca por
 * la que corresponda a su tipo.
 *
 * **Vuelve siempre a la página 1**, y eso no es cosmética: quien está en la
 * página 9 y reordena la tabla está pidiendo otra cosa, y conservar el número
 * lo dejaría en la página 9 de una lista nueva —a veces vacía— sin explicación.
 * `pageHref` ya omite `page` en la 1, así que basta con no pasarlo.
 */
export function ordenHref<K extends string>(
  basePath: string,
  campo: K,
  actual: Orden<K>,
  query: Record<string, string | undefined> = {},
  inicial: Direccion = "asc",
): string {
  const dir: Direccion =
    actual.campo === campo ? (actual.dir === "asc" ? "desc" : "asc") : inicial;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && k !== "page" && k !== "orden" && k !== "dir") {
      params.set(k, v);
    }
  }
  params.set("orden", campo);
  params.set("dir", dir);
  return `${basePath}?${params.toString()}`;
}

/**
 * A dónde lleva elegir un filtro. `undefined` lo quita.
 *
 * Conserva el orden —quien filtró por «críticos» quiere seguir viéndolos como
 * los venía viendo— y descarta la página por lo mismo que `ordenHref`.
 */
export function filtroHref(
  basePath: string,
  clave: string,
  valor: string | undefined,
  query: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && k !== "page" && k !== clave) params.set(k, v);
  }
  if (valor) params.set(clave, valor);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Los parámetros que hay que arrastrar al paginar, ya sin los vacíos.
 *
 * `Pagination` y los enlaces de encabezado reciben este objeto para no perder lo
 * que el usuario eligió. Se limpia aquí y no en cada pantalla porque el fallo
 * —pasar `estado: undefined` y que salga `?estado=undefined` en la URL— se ve
 * tarde y en todas partes a la vez.
 */
export function queryLimpia(
  entradas: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entradas)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Una opción de filtro: lo que va a la URL, cómo se lee y cuántas filas caen.
 *
 * Vive aquí y no junto a los componentes porque la usan los dos lados: el
 * encabezado que la dibuja en el servidor y el desplegable que la enseña en el
 * navegador. Un tipo compartido en el módulo de vocabulario, que no arrastra
 * nada de React.
 */
export type OpcionFiltro = {
  /** El valor que va a la URL. `undefined` es la opción de «todos». */
  valor?: string;
  label: string;
  /** Cuántas filas caen aquí. Se enseña al lado. */
  n?: number;
};
