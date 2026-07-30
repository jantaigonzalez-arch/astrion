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
 * Guarda una imagen subida en /public/uploads/<subdir> y devuelve la ruta
 * pública (p. ej. "/uploads/equipment/ab12.jpg"), o null si no hay archivo.
 * En dev/self-host escribe al disco; en producción serverless conviene migrar
 * a almacenamiento de objetos (S3/Supabase) manteniendo esta misma firma.
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
  const dir = path.join(process.cwd(), "public", "uploads", safeSub);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return `/uploads/${safeSub}/${filename}`;
}
