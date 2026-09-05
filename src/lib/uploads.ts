import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB

/**
 * Directorio donde viven las fotos subidas.
 *
 * En dev: `public/uploads`, y las sirve el propio Next.
 *
 * En producción: un volumen Docker montado fuera del proyecto
 * (UPLOADS_DIR=/data/uploads), servido por nginx en /uploads/. Es el cambio
 * que desbloquea el deploy — antes se escribía dentro de `public/`, que se
 * reconstruye en cada imagen: las fotos desaparecían en el siguiente deploy.
 *
 * Sacarlas de `public/` también evita depender de que Next sirva archivos
 * añadidos al directorio público DESPUÉS del build, que no es un
 * comportamiento sobre el que convenga apoyarse en un build standalone.
 */
// En dev, ruta RELATIVA al directorio de trabajo del proceso (la raíz del
// proyecto, de donde se corre `npm run dev`). Deliberadamente sin
// `process.cwd()`: esa llamada hace que el trazador de archivos del build
// standalone dé por trazado el proyecto entero y meta de más en la imagen.
// En producción UPLOADS_DIR es absoluto y esto no se usa.
const DEV_UPLOADS_DIR = path.join("public", "uploads");

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || DEV_UPLOADS_DIR;
}

/** Prefijo de URL pública. La ruta guardada en la base no cambia: /uploads/… */
export const UPLOADS_URL_PREFIX = "/uploads";

/**
 * Guarda una imagen subida y devuelve su ruta pública
 * (p. ej. "/uploads/equipment/ab12.jpg"), o null si no hay archivo.
 *
 * La firma es la misma que antes a propósito: migrar a almacenamiento de
 * objetos (S3/R2) más adelante es reemplazar el cuerpo de esta función, sin
 * tocar a ninguno de los que la llaman.
 */
export async function saveImage(
  file: FormDataEntryValue | null,
  subdir: string,
): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  if (f.size > MAX_BYTES) throw new Error("La imagen supera el límite de 6 MB.");

  const ext = ALLOWED.get(f.type);
  if (!ext) throw new Error("Formato de imagen no permitido (usa JPG, PNG, WEBP o GIF).");

  const safeSub = subdir.replace(/[^a-z0-9/_-]/gi, "");
  const dir = path.join(uploadsDir(), safeSub);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return `${UPLOADS_URL_PREFIX}/${safeSub}/${filename}`;
}

/**
 * Guarda un COMPROBANTE de gasto: la foto del ticket o su PDF.
 *
 * Función aparte de `saveImage` y no un parámetro suyo, porque lo que cambia no
 * es un ajuste: es qué se considera válido. Una foto de equipo tiene que ser
 * una imagen —se pinta en una ficha—; un comprobante de viáticos llega tal como
 * lo dio el hotel, y hoy eso es un PDF la mitad de las veces. Obligar a
 * convertirlo a JPG para poder subirlo es exactamente el trámite que hace que
 * la gente deje de subir comprobantes.
 *
 * El PDF NO se muestra embebido en la pantalla: se enlaza. Un visor de PDF
 * dentro de una lista de gastos es peso que se paga en cada carga para algo que
 * se abre una vez.
 */
const COMPROBANTES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["application/pdf", "pdf"],
]);

export async function saveReceipt(
  file: FormDataEntryValue | null,
  subdir: string,
): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  if (f.size > MAX_BYTES) throw new Error("El comprobante supera el límite de 6 MB.");

  const ext = COMPROBANTES.get(f.type);
  if (!ext) {
    throw new Error("Formato no permitido en un comprobante (usa JPG, PNG, HEIC o PDF).");
  }

  const safeSub = subdir.replace(/[^a-z0-9/_-]/gi, "");
  const dir = path.join(uploadsDir(), safeSub);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, filename), Buffer.from(await f.arrayBuffer()));
  return `${UPLOADS_URL_PREFIX}/${safeSub}/${filename}`;
}
