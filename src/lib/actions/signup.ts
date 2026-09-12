"use server";

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { platformEvents, tenantSignups } from "@/lib/db/platform";

/**
 * Solicitud de alta desde la web pública.
 *
 * Es la ÚNICA acción del plano de control que corre sin sesión, así que asume
 * que quien la llama es un desconocido y trata todo lo que manda como dato
 * declarado, no verificado: no crea usuario, no crea esquema, no otorga acceso.
 * Solo deja una fila que un superadministrador tiene que aprobar a mano.
 *
 * Lo que devuelve al visitante es deliberadamente el mismo mensaje en casi
 * todos los casos: decirle "ya existe una solicitud con ese correo" o "esa
 * empresa ya es cliente" convertiría el formulario en un detector de quién usa
 * la plataforma, que es justo lo que un competidor querría.
 */

const SignupSchema = z.object({
  companyName: z.string().trim().min(2, "Falta el nombre de la empresa").max(160),
  contactName: z.string().trim().min(2, "Falta tu nombre").max(160),
  email: z.email("Ese correo no parece válido").max(255),
  phone: z.string().trim().max(40).optional(),
  size: z.string().trim().max(40).optional(),
  industry: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type SignupState = {
  ok: boolean;
  /** Mensaje para el visitante. Nunca revela si el correo ya existía. */
  message?: string;
  error?: string;
  /** Errores por campo, para marcar el input que falta. */
  fields?: Record<string, string>;
};

/** Sugiere el identificador a partir del nombre. Es solo una propuesta: al
 *  aprobar, el superadministrador puede corregirlo antes de que se vuelva el
 *  nombre de un esquema de Postgres, que ya no es barato cambiar. */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "e$1") // el slug debe empezar por letra
    .slice(0, 40);
}

export async function requestSignup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // Trampa para robots: es un campo oculto que una persona nunca ve ni llena.
  // Se responde con éxito a propósito — un bot que recibe un error reintenta
  // con otra forma; uno que recibe "gracias" da el trabajo por hecho.
  //
  // Y con EXACTAMENTE la respuesta del camino feliz. Contestaba «gracias»
  // donde una solicitud real contesta «recibida»: la pantalla no enseña el
  // mensaje, pero la respuesta de la acción llega entera al navegador, y un
  // robot que la leyera sabía que había caído en la trampa. Lo encontró
  // `scripts/_probe-acciones-publicas.ts`.
  if (String(formData.get("website") ?? "").trim() !== "") {
    return { ok: true, message: "recibida" };
  }

  const parsed = SignupSchema.safeParse({
    companyName: formData.get("companyName"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    size: formData.get("size") || undefined,
    industry: formData.get("industry") || undefined,
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return { ok: false, error: "Revisa los datos marcados.", fields };
  }

  const locale = String(formData.get("locale") ?? "es").slice(0, 5);
  const email = parsed.data.email.toLowerCase().trim();

  try {
    const db = getDb();

    // Freno de abuso sin depender de infraestructura: si ese correo ya dejó
    // una solicitud en las últimas 24 h, no se acumula otra. Con un mailer o
    // un Redis esto sería una verificación real; hoy evita que un formulario
    // abierto llene la bandeja del operador.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [reciente] = await db
      .select({ id: tenantSignups.id })
      .from(tenantSignups)
      .where(and(eq(tenantSignups.email, email), gt(tenantSignups.createdAt, since)))
      .limit(1);

    if (reciente) {
      // Mismo mensaje que el camino feliz: no confirma nada al visitante.
      return { ok: true, message: "recibida" };
    }

    const [row] = await db
      .insert(tenantSignups)
      .values({
        companyName: parsed.data.companyName,
        desiredSlug: suggestSlug(parsed.data.companyName) || null,
        contactName: parsed.data.contactName,
        email,
        phone: parsed.data.phone ?? null,
        size: parsed.data.size ?? null,
        industry: parsed.data.industry ?? null,
        note: parsed.data.note ?? null,
        locale,
      })
      .returning({ id: tenantSignups.id });

    // Queda en la bitácora de la plataforma: sin tenantId, porque todavía no
    // hay inquilino. Es el rastro de que la solicitud entró y cuándo.
    await db.insert(platformEvents).values({
      eventType: "tenant.signup_requested",
      payload: {
        signupId: row.id,
        empresa: parsed.data.companyName,
        correo: email,
        origen: "web",
      },
    });

    return { ok: true, message: "recibida" };
  } catch (e) {
    console.error("[signup] error:", e);
    return { ok: false, error: "No se pudo registrar la solicitud. Intenta de nuevo." };
  }
}
