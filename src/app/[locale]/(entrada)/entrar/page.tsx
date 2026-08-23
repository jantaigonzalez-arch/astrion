import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMemberships } from "@/lib/tenancy/context";
import { tenantBase } from "@/lib/nav-server";

/**
 * Reparte a cada quien a su plano después de iniciar sesión.
 *
 * Vive en el servidor porque la decisión depende de las membresías, que el
 * navegador no conoce: el personal de Astraion va a la consola de empresas, y
 * el resto al portal de la suya. Con varias membresías se toma la primera —el
 * selector de empresa es trabajo aparte, y hasta que exista es mejor entrar a
 * una que quedarse en una pantalla en blanco.
 */
export default async function EntrarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const prefix = locale === "en" ? "/en" : "";

  const session = await auth();
  if (!session?.user?.id) redirect(`${prefix}/login`);

  if (session.user.kind === "platform") redirect(`${prefix}/platform`);

  const mine = await listMemberships(session.user.id);
  const first = mine.find((m) => m.schemaName);
  if (!first) redirect(`${prefix}/login`);

  // `tenantBase` decide si el portal de esa empresa es un path de este mismo
  // host o un subdominio propio. Armarlo a mano aquí —que es lo que hacía—
  // dejaba al usuario en `astraion.com/evoelution/dashboard` justo después de
  // iniciar sesión: funciona, pero no es la dirección que va a compartir ni la
  // que queremos que memorice.
  redirect(`${await tenantBase(first.slug, locale)}/dashboard`);
}
