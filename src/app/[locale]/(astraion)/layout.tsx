import { setRequestLocale } from "next-intl/server";

/**
 * Astraion ocupa la raíz del sitio: es el negocio principal.
 *
 * Grupo de rutas propio, sin la barra ni el pie de Evoelution, porque ese sitio
 * es de un CLIENTE —el primero, y el caso con el que se está construyendo la
 * plataforma— y vive en /evoelution. Dos empresas, dos audiencias: compartir
 * navegación confundiría a las dos.
 */
export default async function AstraionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <>{children}</>;
}
