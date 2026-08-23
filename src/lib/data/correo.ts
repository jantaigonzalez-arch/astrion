import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";
import { requireTenant } from "@/lib/tenancy/context";

/**
 * La configuración de correo de la empresa, TAL COMO PUEDE VERSE.
 *
 * La contraseña no sale de aquí ni cifrada: la pantalla solo necesita saber si
 * hay una puesta, y devolver el sobre sellado sería mandarlo al navegador para
 * nada. `configurado` es esa respuesta, y es todo lo que la interfaz recibe.
 */
export async function getCorreoDeLaEmpresa() {
  const ctx = await requireTenant();
  const [t] = await getDb()
    .select({
      host: tenants.smtpHost,
      port: tenants.smtpPort,
      user: tenants.smtpUser,
      pass: tenants.smtpPassword,
      checked: tenants.smtpCheckedAt,
      from: tenants.mailFrom,
      fromName: tenants.mailFromName,
      replyTo: tenants.mailReplyTo,
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

  return {
    configurado: Boolean(t?.host && t?.pass),
    host: t?.host ?? "",
    port: t?.port ?? 587,
    user: t?.user ?? "",
    from: t?.from ?? "",
    fromName: t?.fromName ?? "",
    replyTo: t?.replyTo ?? "",
    comprobado: t?.checked ?? null,
  };
}
