import { llaveDeColumna } from "@/lib/export/registro";
import { datasetPorId } from "@/lib/export/datasets";
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/tickets";
import { PURCHASE_STATUS_LABEL } from "@/lib/domain/purchasing";
import { ESTADO_LABELS as VIATICO_ESTADOS } from "@/lib/viaticos";
import { DescargarDialogo, type ColumnaOpcion } from "./descargar-dialogo";

/**
 * El botón de descarga de un listado: resuelve el dataset y abre el diálogo.
 *
 * ── POR QUÉ ESTA MITAD ES DE SERVIDOR ──────────────────────────────────────
 *
 * Las columnas de un dataset viven en `lib/export/datasets`, que importa la capa
 * de datos entera y lleva `server-only`. Enviarlo al navegador no es una opción,
 * y tampoco hace falta: lo único que el diálogo necesita es una lista de
 * `{ llave, título }`, que es lo que se arma aquí.
 *
 * Es el mismo reparto que ya usa la barra lateral: el modelo decide en el
 * servidor y el componente de cliente solo dibuja.
 */

/**
 * Cómo se lee un filtro en la ventana.
 *
 * Reutiliza las etiquetas que ya existen en cada módulo en vez de escribir otra
 * lista. Una segunda lista de nombres es una lista que se queda vieja: el día
 * que se añada un estado de ticket, aquí saldría el valor crudo — y nadie lo
 * notaría hasta que un usuario preguntara qué es «pending_review».
 */
const ETIQUETAS: Record<string, string> = {
  // Los nombres de los campos.
  estado: "Estado",
  prioridad: "Prioridad",
  categoria: "Categoría",
  tecnico: "Técnico",
  sla: "SLA",
  marca: "Marca",
  laboratorio: "Laboratorio",
  contrato: "Contrato",
  vigencia: "Vigencia",
  vendedor: "Vendedor",
  proveedor: "Proveedor",
  archivo: "Archivo",
  orden: "Ordenado por",
  dir: "Dirección",
  por: "Por página",
  // Los valores, de donde ya estaban declarados.
  ...Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [k, v.es])),
  ...Object.fromEntries(Object.entries(PRIORITY_LABELS).map(([k, v]) => [k, v.es])),
  ...Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, v.es])),
  ...PURCHASE_STATUS_LABEL,
  ...VIATICO_ESTADOS,
  con: "Con contrato",
  sin: "Sin contrato",
  vencido: "Vencido",
  asc: "Ascendente",
  desc: "Descendente",
};

export function BotonDescargar({
  dataset,
  query = {},
}: {
  /** El id del registro: `tickets`, `contratos`… Ver `lib/export/datasets`. */
  dataset: string;
  /** Los filtros de la pantalla, tal como los arma `queryLimpia`. */
  query?: Record<string, string | undefined>;
}) {
  const d = datasetPorId(dataset);
  /*
    Sin dataset no se pinta nada, en vez de un botón que da 404.

    Pasa si alguien escribe mal el id al enganchar una pantalla nueva. Un botón
    roto se descubre cuando un usuario lo pulsa; un botón ausente, al probar la
    pantalla — que es mucho antes.
  */
  if (!d) return null;

  const columnas: ColumnaOpcion[] = d.columnas.map((c) => ({
    llave: llaveDeColumna(c.titulo),
    titulo: c.titulo,
  }));

  return (
    <DescargarDialogo
      dataset={dataset}
      columnas={columnas}
      query={query}
      etiquetas={ETIQUETAS}
    />
  );
}
