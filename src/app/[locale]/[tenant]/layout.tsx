import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants, tenantSchemas } from "@/lib/db/platform";
import {
  apexOrigin,
  defaultProto,
  portOf,
  tenantFromHost,
} from "@/lib/tenancy/host";
import { TenantRoutingProvider } from "@/lib/nav";

/**
 * Frontera del inquilino: `evoelution.astraion.com/…`
 *
 * El inquilino vive en la URL y no en una cookie, y eso resuelve tres cosas de
 * golpe: la dirección se puede compartir y marcar, "en qué empresa estoy" deja
 * de ser un estado invisible, y dos pestañas abiertas en dos empresas distintas
 * dejan de pisarse —que con una cookie global era inevitable—.
 *
 * En qué parte de la URL vive depende del despliegue: subdominio si hay dominio
 * raíz configurado, primer segmento del path si no. Este layout es el mismo en
 * los dos casos porque el proxy reescribe el path antes de que Next lo vea; lo
 * único que cambia es qué se le dice al navegador sobre cómo construir enlaces.
 *
 * Aquí solo se valida que la empresa EXISTA. El permiso se comprueba en el
 * layout de `(app)`, porque la pantalla de acceso cuelga de este mismo
 * segmento y tiene que verse sin sesión.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);

  const db = getDb();
  const [row] = await db
    .select({ slug: tenants.slug, schemaName: tenantSchemas.schemaName })
    .from(tenants)
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(eq(tenants.slug, tenant))
    .limit(1);

  // Un slug inventado es un 404, no una pantalla de "no tienes permiso": esto
  // es una URL pública y no debe servir para averiguar qué empresas existen.
  if (!row?.schemaName) notFound();

  // El navegador no ve la reescritura del proxy, así que no puede deducir si el
  // inquilino va en el host o en el path. Se lo decimos desde aquí, que es el
  // único punto por el que pasan todas las pantallas del portal.
  const host = (await headers()).get("host");
  const onSubdomain = tenantFromHost(host) !== null;

  return (
    <TenantRoutingProvider
      mode={onSubdomain ? "host" : "path"}
      // Solo en subdominio. En modo path las rutas del apex son del mismo
      // host y prefijarlas con un origen absoluto sería ruido.
      apex={onSubdomain ? apexOrigin(defaultProto(), portOf(host)) : null}
    >
      {children}
    </TenantRoutingProvider>
  );
}
