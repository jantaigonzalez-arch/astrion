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
 * LOS ARCHIVOS SE GUARDAN BAJO LA CARPETA DE SU EMPRESA.
 *
 * Antes iban todos al mismo sitio —`/uploads/equipment/<uuid>.jpg`— y eso hacía
 * imposible la pregunta que hoy se factura: cuánto guarda CADA cliente. Sin
 * saberlo no hay cupo que poner ni plan que vender.
 *
 * Los archivos YA SUBIDOS se quedan donde están y siguen sirviéndose: sus
 * rutas están guardadas en la base y reescribirlas sería mover ficheros y
 * actualizar filas para ganar prolijidad. Lo que cuentan es despreciable —uno
 * en producción— y el cupo mide la carpeta del inquilino, así que un archivo
 * viejo simplemente no se le cobra a nadie. Se dice aquí para que quien vea la
 * cuenta descuadrada por medio mega sepa por qué.
 */
async function carpetaDelInquilino(): Promise<string> {
  const { requireTenant } = await import("@/lib/tenancy/context");
  const { slug } = await requireTenant();
  return slug.replace(/[^a-z0-9_-]/gi, "");
}

/**
 * Lo que ocupa hoy una empresa: adjuntos en disco, en bytes.
 *
 * ── CUESTA LO QUE ARCHIVOS TENGA, Y EL CUPO ES LO QUE LO ACOTA ────────────
 *
 * Recorre el árbol con un `stat` por archivo, así que el costo crece con el
 * número de ficheros. Medido: 40 ms con 3 000. Suena mal hasta que se ve qué lo
 * limita — el propio cupo:
 *
 *   5 GB de cupo ÷ 1,5 MB de adjunto típico ≈ 3 400 archivos ≈ 40 ms
 *
 * Es decir, 40 ms es el PEOR caso de una empresa con el cupo lleno, en una
 * pantalla que se abre de vez en cuando y en una subida que ya está escribiendo
 * en disco. Se aceptó por eso, no por descuido.
 *
 * ── Y AQUÍ ESTÁ EL ACOPLE QUE HAY QUE RECORDAR ────────────────────────────
 *
 * Si algún día se venden cupos de 100 GB —lo que exige añadir disco primero—,
 * el mismo recorrido pasa a unos 800 ms y deja de ser aceptable. Ese es el
 * momento de llevar el total a una columna que se actualice al subir, no antes:
 * un contador que hay que mantener sincronizado es deuda, y hoy no compra nada.
 *
 * Queda escrito aquí porque el día que alguien suba el cupo no va a estar
 * pensando en este archivo.
 */
export async function bytesDeAdjuntos(slug: string): Promise<number> {
  const { readdir, stat } = await import("node:fs/promises");
  const raiz = path.join(uploadsDir(), slug.replace(/[^a-z0-9_-]/gi, ""));
  let total = 0;
  async function caminar(dir: string) {
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // la carpeta no existe todavía: cero, y es correcto
    }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await caminar(p);
      else total += (await stat(p)).size;
    }
  }
  await caminar(raiz);
  return total;
}

/**
 * ¿Le cabe este archivo a la empresa?
 *
 * Se comprueba ANTES de escribir, no después: escribir y luego borrar deja el
 * disco tocado y una ventana en la que otro inquilino puede quedarse sin sitio.
 *
 * Y BLOQUEA, no avisa. Un cupo que no se hace cumplir es una cifra en un
 * contrato, no un control: el disco se llena igual y el primer síntoma es la
 * aplicación dejando de escribir para TODOS a la vez, que es exactamente lo que
 * esto viene a evitar. El mensaje dice cuánto lleva y cuánto tiene, para que la
 * salida sea hablar del plan y no adivinar.
 */
async function vetoDeCupo(slug: string, entrantes: number): Promise<void> {
  const { getDb } = await import("@/lib/db");
  const { tenants } = await import("@/lib/db/platform");
  const { eq } = await import("drizzle-orm");

  /*
    SE BUSCA POR SLUG Y NO POR ID, y no es indiferente.

    El slug es el mismo que nombra la carpeta cuyos bytes se acaban de contar,
    así que las dos mitades de esta comprobación hablan de la misma empresa por
    construcción. Con el id venían de sitios distintos, y la primera versión de
    la prueba pasó en verde porque el id no resolvía y el cupo se leía como
    cero: el veto no bloqueaba y parecía que sí.
  */
  const [t] = await getDb()
    .select({ cupo: tenants.storageQuotaMb })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  /*
    SIN FILA O SIN CUPO NO SE BLOQUEA, y es una decisión, no un descuido.

    Un fallo al leer la fila de la empresa no puede impedirle a un ingeniero
    adjuntar el comprobante de su viaje: el costo de dejar pasar unos megas de
    más es cero, y el de bloquear a un cliente que paga por algo que no es culpa
    suya, no. Cero significa «sin cupo configurado» y se respeta igual.

    Queda escrito porque una puerta abierta sin explicación se lee como un
    olvido, y la siguiente persona la cierra sin saber lo que rompe.
  */
  const cupoBytes = Number(t?.cupo ?? 0) * 1024 * 1024;
  if (!cupoBytes) return;

  const usados = await bytesDeAdjuntos(slug);
  if (usados + entrantes <= cupoBytes) return;

  const mb = (n: number) => (n / 1048576).toFixed(0);
  throw new Error(
    `Se acabó el espacio del plan: llevas ${mb(usados)} MB de ${mb(cupoBytes)} MB. ` +
      `Borra algún adjunto o habla con nosotros para ampliarlo.`,
  );
}

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
  const slug = await carpetaDelInquilino();
  await vetoDeCupo(slug, f.size);

  const dir = path.join(uploadsDir(), slug, safeSub);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return `${UPLOADS_URL_PREFIX}/${slug}/${safeSub}/${filename}`;
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
  const slug = await carpetaDelInquilino();
  await vetoDeCupo(slug, f.size);

  const dir = path.join(uploadsDir(), slug, safeSub);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, filename), Buffer.from(await f.arrayBuffer()));
  return `${UPLOADS_URL_PREFIX}/${slug}/${safeSub}/${filename}`;
}
