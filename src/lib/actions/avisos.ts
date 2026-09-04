"use server";

import { revalidateTenant } from "@/lib/revalidate";
import { marcarLeidos } from "@/lib/notificaciones";

/**
 * Marcar avisos como leídos.
 *
 * No lleva guardia de rol ni de módulo, y es correcto: `marcarLeidos` acota
 * SIEMPRE por el id de quien pregunta, así que lo único que alguien puede hacer
 * es marcar lo suyo. Poner aquí un permiso de módulo sería peor que inútil —
 * dejaría a una persona con la campana llena y sin poder vaciarla porque no
 * tiene Servicio.
 */
export async function marcarAvisosLeidos(form: FormData): Promise<void> {
  const uno = String(form.get("id") ?? "").trim();
  await marcarLeidos(uno ? [uno] : undefined);
  revalidateTenant();
}
