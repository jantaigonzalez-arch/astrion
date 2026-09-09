import "server-only";
import { getTenantBrand } from "@/lib/data/platform";

/**
 * EL MEMBRETE DE UN DOCUMENTO IMPRESO, resuelto en un solo sitio.
 *
 * ── POR QUÉ ESTO EXISTE ────────────────────────────────────────────────────
 *
 * La cascada del logo —documento → marca → monograma— y el armado del pie
 * estaban ESCRITOS DENTRO del reporte de servicio. Con un solo documento eso
 * pasa por detalle; en cuanto apareció el segundo (viáticos) la alternativa era
 * copiarlos, y una copia de esta lógica es la que se queda sin el renglón nuevo
 * el día que alguien añada un dato al membrete.
 *
 * Aquí la homogeneidad no depende de que nadie se olvide: los documentos no
 * pueden diferir porque leen lo mismo.
 *
 * ── NO ES UN MICROSERVICIO, Y ES DELIBERADO ────────────────────────────────
 *
 * Imprimir es HTML renderizado en el servidor con los datos del inquilino.
 * Sacarlo a un proceso aparte obligaría a duplicar tres cosas —el acceso al
 * esquema, el permiso de cada módulo y el propio membrete— para no ganar
 * ninguna: no es pesado, no escala por su cuenta y no lo consume nadie fuera de
 * la aplicación. El microservicio que sí tiene este repo, `intelligence`,
 * existe porque es Python con su propio runtime.
 *
 * El día que haga falta MANDAR el documento por correo sin que nadie pulse
 * imprimir, sí hará falta un proceso aparte que renderice PDF. Esta capa es lo
 * que lo hará fácil: habrá una sola definición de documento que darle.
 */

export type Membrete = {
  /** El nombre corto si lo hay, y si no el legal. Nunca vacío. */
  nombre: string;
  /** Ruta del logo ya resuelta por la cascada, o `null` para el monograma. */
  logo: string | null;
  tagline: string | null;
  /**
   * Las piezas del pie, ya filtradas.
   *
   * Lo que falta NO se rellena ni se hereda: imprimir la dirección de otra
   * empresa es el fallo que la 0029 de plataforma vino a arreglar. Vacío
   * significa que el pie entero no se dibuja.
   */
  pie: string[];
};

export async function membreteDeDocumento(tenantSlug: string): Promise<Membrete> {
  const marca = await getTenantBrand(tenantSlug);

  const nombre = marca?.brandName || marca?.name || "";
  return {
    nombre,
    // La cascada, escrita UNA vez: el logo del documento, si no el de la marca,
    // y si no, el monograma que dibuja `<Documento>`. Nunca el de otra empresa.
    logo: marca?.documentLogoUrl ?? marca?.logoUrl ?? null,
    tagline: marca?.tagline?.trim() || null,
    pie: [nombre, marca?.contactAddress, marca?.contactPhone, marca?.contactEmail]
      .map((v) => (v ?? "").trim())
      .filter(Boolean),
  };
}
