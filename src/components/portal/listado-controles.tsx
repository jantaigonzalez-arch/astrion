import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { filtroHref, ordenHref, type Direccion, type Orden } from "@/lib/listado";

/**
 * Los controles de un listado: encabezados que ordenan y fichas que filtran.
 *
 * Componentes de SERVIDOR, y son enlaces de verdad. Es la misma decisión que
 * tomó `Pagination` —«cada página es una URL que se puede compartir, marcar y
 * abrir en otra pestaña»— aplicada a lo mismo un paso más allá: una tabla
 * ordenada por prioridad y filtrada por técnico es una vista concreta del
 * trabajo, y esa vista tiene que caber en un mensaje.
 *
 * Sin JavaScript de por medio no hay hidratación que esperar, la tabla llega
 * ordenada del servidor y el botón de atrás funciona.
 */

/* ------------------------- Encabezado que ordena ------------------------- */

/**
 * Un `<th>` que ordena por su columna.
 *
 * La flecha señala hacia dónde está ordenado AHORA, no hacia dónde llevaría
 * pulsar. Es la convención de toda tabla y la contraria confunde: una flecha
 * que promete lo que va a pasar obliga a pulsar para saber cómo estás viendo lo
 * que ya tenés delante.
 *
 * Las columnas ordenables se distinguen de las que no por el icono neutro de
 * dos puntas, presente siempre. Sin él, la única forma de averiguar si una
 * columna ordena es pulsarla — y las que no hacen nada enseñan que la tabla no
 * responde.
 */
export function ThOrden<K extends string>({
  campo,
  children,
  actual,
  basePath,
  query,
  inicial = "asc",
  className,
}: {
  campo: K;
  children: React.ReactNode;
  actual: Orden<K>;
  basePath: string;
  query?: Record<string, string | undefined>;
  inicial?: Direccion;
  className?: string;
}) {
  const activo = actual.campo === campo;
  const Icono = !activo ? ChevronsUpDown : actual.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={cn("px-4 py-3 font-medium", className)}
      // Lo que un lector de pantalla necesita para anunciar el estado de la
      // columna. Sin esto, la flecha es información que solo existe si ves.
      aria-sort={activo ? (actual.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={ordenHref(basePath, campo, actual, query, inicial)}
        className={cn(
          "group inline-flex items-center gap-1 whitespace-nowrap rounded-sm transition-colors hover:text-foreground",
          activo && "text-foreground",
        )}
        // El encabezado ya dice el nombre de la columna; el título explica qué
        // hace pulsarlo, que es lo que no se ve.
        title={activo ? "Cambiar el sentido del orden" : "Ordenar por esta columna"}
      >
        {children}
        <Icono
          className={cn(
            "size-3 shrink-0 transition-opacity",
            activo ? "opacity-100" : "opacity-30 group-hover:opacity-70",
          )}
          aria-hidden="true"
        />
      </Link>
    </th>
  );
}

/* ------------------------- Orden sin tabla ------------------------- */

/**
 * «Ordenar por: Número · Monto · Vencimiento», para listas que no son tablas.
 *
 * Contratos, pedidos y requisiciones se dibujan como TARJETAS, y una tarjeta no
 * tiene encabezado donde pulsar. Sin esto, esas listas se quedaban sin ordenar
 * solo por cómo están dibujadas — que es una razón de presentación decidiendo
 * una capacidad.
 *
 * Habla el mismo idioma que `ThOrden`: mismos parámetros en la URL, misma
 * flecha, misma regla de volver a la página 1. Quien pase una lista de tarjetas
 * a tabla no tiene que cambiar nada más que el control.
 */
export function OrdenFichas<K extends string>({
  campos,
  actual,
  basePath,
  query,
  titulo = "Ordenar por",
}: {
  campos: Array<{ campo: K; label: string; inicial?: Direccion }>;
  actual: Orden<K>;
  basePath: string;
  query?: Record<string, string | undefined>;
  titulo?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </span>
      {campos.map(({ campo, label, inicial = "asc" }) => {
        const activo = actual.campo === campo;
        const Icono = !activo ? ChevronsUpDown : actual.dir === "asc" ? ArrowUp : ArrowDown;
        return (
          <Link
            key={campo}
            href={ordenHref(basePath, campo, actual, query, inicial)}
            aria-current={activo ? "true" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              activo
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {label}
            <Icono
              className={cn("size-3 shrink-0", activo ? "opacity-100" : "opacity-40")}
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------- Fichas que filtran ------------------------- */

export type OpcionFiltro = {
  /** El valor que va a la URL. `undefined` es la ficha de «todos». */
  valor?: string;
  label: string;
  /** Cuántas filas caen aquí. Se enseña al lado. */
  n?: number;
};

/**
 * Una fila de fichas para filtrar por un campo.
 *
 * Fichas y no un `<select>` cuando las opciones son pocas y se miran seguido:
 * un desplegable esconde tanto las opciones como cuál está activa, y en un
 * filtro de estado eso es justo lo que hay que ver de un vistazo.
 *
 * El conteo va en la ficha a propósito. Un filtro que lleva a cero resultados
 * es una pérdida de tiempo que se puede evitar antes de pulsarlo, y ver «12»
 * al lado de «Vencidos» ya responde la pregunta sin filtrar nada.
 */
export function FiltroFichas({
  titulo,
  clave,
  opciones,
  activo,
  basePath,
  query,
}: {
  titulo: string;
  clave: string;
  opciones: OpcionFiltro[];
  activo: string | undefined;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  /*
    Las opciones vacías no se ofrecen.

    Una ficha que dice «En espera 0» es un camino a una lista vacía, y con
    cuatro o cinco de ellas la barra deja de leerse como un filtro y pasa a
    leerse como un inventario del catálogo. La empresa usa cuatro de las siete
    categorías de ticket y tres de los cinco estados; enseñar las otras no
    informa de nada que alguien pueda hacer.

    La excepción es la que está PUESTA: si el filtro activo se quedara sin
    filas, esconderlo dejaría la barra sin decir por qué la tabla está vacía y
    sin la ficha desde la que se quitó.
  */
  const visibles = opciones.filter(
    (o) => o.n === undefined || o.n > 0 || (o.valor ?? undefined) === activo,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </span>
      {visibles.map((o) => {
        const puesto = (o.valor ?? undefined) === activo;
        return (
          <Link
            key={o.valor ?? "todos"}
            href={filtroHref(basePath, clave, o.valor, query)}
            aria-current={puesto ? "true" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              puesto
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {o.label}
            {o.n !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  puesto ? "text-foreground/70" : "text-muted-foreground/70",
                )}
              >
                {o.n}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * La barra que agrupa los filtros de un listado.
 *
 * Existe para que las pantallas no repitan el mismo contenedor —y para que
 * cuando haya que cambiarlo, cambie en las once a la vez—. El enlace de limpiar
 * solo aparece cuando hay algo que limpiar: un botón permanentemente inerte
 * enseña a ignorar la barra entera.
 */
export function BarraFiltros({
  children,
  hayFiltros,
  basePath,
  className,
}: {
  children: React.ReactNode;
  hayFiltros: boolean;
  basePath: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      {children}
      {hayFiltros && (
        <Link
          href={basePath}
          className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Quitar filtros
        </Link>
      )}
    </div>
  );
}
