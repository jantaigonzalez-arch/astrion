/**
 * Paginación de listados. Sin dependencias de servidor: lo usan las funciones
 * de datos para calcular el desplazamiento y los componentes para pintar los
 * controles.
 *
 * Por qué existe en vez de un `limit` a ojo en cada consulta: el número de
 * página llega por la URL, o sea desde fuera, y un `offset` es un salto directo
 * dentro de una tabla. `parsePage` es el único sitio donde ese valor deja de
 * ser texto ajeno y pasa a ser un entero acotado — `?page=-1`, `?page=abc` y
 * `?page=1e9` tienen que morir aquí y no en la consulta.
 */

/** Filas por página. 25 entra en una pantalla sin scroll infinito. */
export const PER_PAGE = 25;

/** Tope duro: nadie pide 5 000 filas "para exportar" desde la barra de direcciones. */
export const MAX_PER_PAGE = 100;

export type PageParams = { page: number; perPage: number; offset: number };

/**
 * Convierte `?page=` y `?por=` en algo con lo que se puede consultar.
 *
 * Cualquier basura cae a la página 1. No se avisa del error a propósito: una
 * URL manipulada no merece una pantalla de error, merece el comportamiento por
 * omisión.
 */
export function parsePage(
  searchParams: { page?: string; por?: string } | undefined,
  perPageDefault = PER_PAGE,
): PageParams {
  const rawPage = Number(searchParams?.page);
  const page =
    Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, 100_000) : 1;

  const rawPer = Number(searchParams?.por);
  const perPage =
    Number.isSafeInteger(rawPer) && rawPer >= 1
      ? Math.min(rawPer, MAX_PER_PAGE)
      : perPageDefault;

  return { page, perPage, offset: (page - 1) * perPage };
}

/** Cuántas páginas hay. Siempre al menos una, aunque no haya ni una fila. */
export function pageCountOf(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

/**
 * El rango que se está viendo, para el "26–50 de 602" del pie.
 *
 * `to` se acota con el total porque la última página casi nunca está llena y
 * "601–625 de 602" es la clase de detalle que hace dudar del resto de la
 * pantalla.
 */
export function rangeOf(
  total: number,
  { page, perPage }: PageParams,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * perPage + 1;
  return { from, to: Math.min(page * perPage, total) };
}

/** `?page=3&estado=open`, conservando el resto de los filtros de la URL. */
export function pageHref(
  basePath: string,
  page: number,
  query: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && k !== "page") params.set(k, v);
  }
  // La página 1 no se escribe: deja la URL limpia y hace que el enlace del menú
  // y el de "volver a la primera" sean el mismo, en vez de dos que compiten.
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
