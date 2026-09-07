import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { puedeEn, requireTenant, tenantDbReadOnly } from "@/lib/tenancy/context";
import { llaveDeColumna, TOPE_FILAS } from "@/lib/export/registro";
import { DATASETS, datasetPorId } from "@/lib/export/datasets";
import { aCsv, aExcel, type Columna } from "@/lib/export/formatos";
import { hoyCivil } from "@/lib/fechas";

/**
 * LA CAPA DE EXTRACCIÓN: un solo borde para todas las descargas del portal.
 *
 *   /api/export/tickets?formato=xlsx&estado=open&orden=prioridad
 *
 * Los parámetros de filtro son LOS MISMOS de la pantalla y se los pasa tal cual
 * al dataset, que los interpreta con los mismos ayudantes. Ver `registro.ts`.
 *
 * ── LO QUE HACE SEGURA ESTA RUTA ───────────────────────────────────────────
 *
 * Una ruta de descarga es, por definición, el sitio por donde salen los datos
 * de la empresa en bloque. Cuatro cosas la sostienen, y ninguna es opcional:
 *
 * 1 · EL INQUILINO NO SE ELIGE. Sale del contexto de la petición, como en
 *     cualquier pantalla. No hay un parámetro de empresa que alguien pueda
 *     cambiar en la barra de direcciones.
 *
 * 2 · EL PERMISO ES EL DEL MÓDULO, comprobado con `puedeEn` — la misma regla
 *     que deja entrar a la pantalla. Una descarga no puede dar acceso a algo
 *     que en pantalla no se ve; lo único que hace es llevárselo en un archivo.
 *
 * 3 · EL ACOTADO POR PERSONA VIAJA AL DATASET. Quien en pantalla solo ve su
 *     cartera se lleva su cartera: `administra` decide, y lo aplica cada
 *     `filas()` con la misma condición que usa su listado. Sin esto, el botón
 *     de descarga sería la puerta de atrás al padrón completo.
 *
 * 4 · SE LEE POR EL POOL DE SOLO LECTURA. Postgres rechaza cualquier escritura,
 *     y —más importante— la descarga no ocupa una de las dos conexiones que la
 *     empresa tiene para su trabajo del día. Ver `tenantDbReadOnly`.
 *
 * ── Y LO QUE LA HACE NO TUMBAR EL SERVIDOR ─────────────────────────────────
 *
 * Generar un .xlsx es trabajo SÍNCRONO: mientras dura, el proceso de Node no
 * atiende ninguna otra petición. Medido, 20 000 filas son 173 ms. Por eso hay
 * tope, y por eso al superarlo se RECHAZA en vez de recortar — un archivo
 * truncado en silencio se suma y da un total que no es.
 */

export const dynamic = "force-dynamic";

/** Nombre de archivo sin sorpresas en Windows ni en el encabezado HTTP. */
function nombreArchivo(base: string, ext: string): string {
  const limpio = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${limpio}-${hoyCivil()}.${ext}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const { dataset: id } = await params;
  const d = datasetPorId(id);
  if (!d) {
    return NextResponse.json(
      { error: `No existe la extracción «${id}».`, disponibles: DATASETS.map((x) => x.id) },
      { status: 404 },
    );
  }

  // Empresa activa. Sin ella no hay nada que leer: `requireTenant` lanza, y es
  // lo correcto — una descarga sin inquilino no es un caso a degradar.
  await requireTenant();

  if (!(await puedeEn(d.modulo, "ver"))) {
    return NextResponse.json(
      { error: "No tienes permiso para descargar este módulo." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const formato = url.searchParams.get("formato") === "csv" ? "csv" : "xlsx";

  /*
    Los parámetros de la CAPA no viajan al dataset.

    `formato`, `cols` y `todo` los interpreta esta ruta; todo lo demás son los
    filtros de la pantalla y se pasan tal cual. Sin esta separación, un dataset
    podría llegar a tener un filtro llamado `cols` y las dos cosas se pisarían.
  */
  const DE_LA_CAPA = new Set(["formato", "cols", "todo"]);
  const sp: Record<string, string | undefined> = {};
  // `todo=1` descarga el módulo entero: es la casilla «ignorar los filtros» del
  // diálogo, y se resuelve NO pasándole ninguno al dataset.
  if (url.searchParams.get("todo") !== "1") {
    for (const [k, v] of url.searchParams) if (!DE_LA_CAPA.has(k)) sp[k] = v;
  }

  const session = await auth();
  const db = await tenantDbReadOnly();

  let filas: unknown[];
  try {
    filas = await d.filas({
      sp,
      db,
      userId: session?.user?.id ?? null,
      administra: await puedeEn(d.modulo, "administrar"),
    });
  } catch (e) {
    // Un fallo al leer NO puede devolver un archivo vacío: quien lo abre vería
    // cero filas y concluiría que no hay datos, que es una respuesta distinta.
    console.error(`[export] ${id} falló al leer`, e);
    return NextResponse.json(
      { error: "No se pudo leer la información para la descarga." },
      { status: 500 },
    );
  }

  if (filas.length >= TOPE_FILAS) {
    /*
      SE RECHAZA, NO SE RECORTA.

      `>=` y no `>`: la consulta pide exactamente el tope, así que llegar al
      número redondo significa que casi con seguridad hay más detrás. Devolver
      esas filas sería devolver «las primeras veinte mil» haciéndolas pasar por
      «todas».
    */
    return NextResponse.json(
      {
        error:
          `La descarga supera el límite de ${TOPE_FILAS.toLocaleString("es-MX")} filas. ` +
          "Filtra en la pantalla y vuelve a descargar: la descarga respeta los filtros.",
      },
      { status: 413 },
    );
  }

  /*
    LAS COLUMNAS QUE PIDIÓ LA PERSONA.

    Se filtran contra las del dataset, así que un nombre inventado en la URL no
    puede añadir nada: lo más que consigue es que se ignore. Sin `cols` van
    todas, que es lo que hace que el enlace de siempre siga funcionando.

    Si no queda ninguna se RECHAZA en vez de mandar un archivo con encabezados y
    sin datos: un archivo vacío parece una descarga sin resultados, y eso es una
    respuesta distinta de «pediste columnas que no existen».
  */
  const todas = d.columnas as unknown as Columna<unknown>[];
  /*
    `has` y no el valor: si el parámetro VIENE, manda — aunque venga vacío.

    Mirando solo el valor, `?cols=` caía en «no se pidió nada» y devolvía todas
    las columnas, mientras que `?cols=inventada` daba 400. Dos formas de pedir
    mal con dos respuestas distintas, y la peligrosa era la silenciosa: quien
    pidió columnas concretas recibía un archivo con todas y ninguna señal.
  */
  const pedidas = url.searchParams.has("cols")
    ? (url.searchParams.get("cols") ?? "").split(",").filter(Boolean)
    : null;
  const columnas = pedidas
    ? todas.filter((c) => pedidas.includes(llaveDeColumna(c.titulo)))
    : todas;

  if (columnas.length === 0) {
    return NextResponse.json(
      {
        error: "Ninguna de las columnas pedidas existe en esta descarga.",
        disponibles: todas.map((c) => llaveDeColumna(c.titulo)),
      },
      { status: 400 },
    );
  }
  const cuerpo =
    formato === "csv"
      ? aCsv(columnas, filas)
      : await aExcel(columnas, filas, d.nombre);

  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      "Content-Type":
        formato === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo(d.nombre, formato)}"`,
      "Content-Length": String(cuerpo.length),
      // Una descarga lleva datos de la empresa: no se guarda en ninguna caché
      // intermedia, y menos con varias empresas detrás del mismo dominio.
      "Cache-Control": "no-store, private",
    },
  });
}
