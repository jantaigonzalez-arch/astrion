import { cn } from "@/lib/utils";

/**
 * La tabla del ERP. Una sola, para los treinta y tres listados.
 *
 * ── QUÉ APORTA SOBRE UN `<table>` A SECAS ─────────────────────────────────
 *
 * El contenedor que se desplaza —una tabla ancha se mueve DENTRO de su caja y
 * nunca empuja la página—, el encabezado que acompaña al desplazamiento, el
 * realce de la fila bajo el cursor, y el relleno que responde a la densidad que
 * eligió la persona. Todo eso vivía escrito a mano y distinto en cada pantalla,
 * o directamente no vivía.
 *
 * ── SE ENVUELVE, NO SE REESCRIBE ──────────────────────────────────────────
 *
 * El contenido va tal cual: los mismos `<thead>`, `<tr>` y `<td>` que ya
 * estaban. El estilo lo pone `.tabla-erp` desde `globals.css`, con
 * especificidad suficiente para ganarle a las utilidades que traen las celdas.
 *
 * Eso es lo que permitió homogeneizar treinta y tres tablas sin recorrer las
 * mil celdas que hay dentro. Las clases viejas siguen ahí, ya sin efecto, y se
 * pueden ir quitando sin que nada cambie de aspecto.
 *
 * ── LOS NÚMEROS SE MARCAN, NO SE ADIVINAN ─────────────────────────────────
 *
 * Una columna de importes se alinea a la derecha y usa cifras de ancho fijo,
 * que es lo que permite comparar dos cantidades sin leerlas. Se pide con
 * `data-num` en el `th` y en sus `td`; deducirlo del contenido fallaría con un
 * folio, que parece número y se lee como texto.
 */
export function Tabla({
  children,
  className,
  /** Alto máximo del área que se desplaza. Con él, el encabezado pegajoso
   *  se queda dentro de la caja en vez de al borde de la ventana. */
  alto,
}: {
  children: React.ReactNode;
  className?: string;
  alto?: string;
}) {
  return (
    <div
      className={cn("tabla-caja", className)}
      style={alto ? { maxHeight: alto, overflowY: "auto" } : undefined}
    >
      <table className="tabla-erp text-sm">{children}</table>
    </div>
  );
}

/**
 * Lo que se enseña cuando no hay filas.
 *
 * Va como fila de la propia tabla y no como una tarjeta aparte, para que el
 * encabezado siga a la vista: qué columnas tiene el listado es información
 * incluso cuando está vacío, y quita la duda de si la pantalla cargó mal.
 */
export function FilaVacia({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr className="hover:!bg-transparent">
      <td
        colSpan={colSpan}
        className="py-10 text-center text-sm text-muted-foreground"
      >
        {children}
      </td>
    </tr>
  );
}
