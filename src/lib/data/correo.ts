import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";
import { requireTenant } from "@/lib/tenancy/context";
import { transporteDe } from "@/lib/mail";

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
    /*
      Por dónde saldrían los avisos HOY.

      Se resuelve aquí para que la pantalla lo diga sin obligar a pulsar
      «Probar»: con el transporte de consola no sale un solo correo, y eso no se
      notaba por ninguna parte —ni en la pantalla ni en el botón, que además
      contestaba que sí—. Un despliegue puede llevar meses sin mandar un aviso
      y sin que nadie tenga cómo enterarse.
    */
    transporte: await transporteDe(ctx.tenantId),
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
