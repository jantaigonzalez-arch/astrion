import { setRequestLocale } from "next-intl/server";

/**
 * La iniciativa vive en su propio grupo de rutas, sin la barra ni el pie del
 * sitio de Evoelution.
 *
 * No es capricho de maquetación: ese sitio es de Evoelution **la empresa de
 * servicio** —el primer inquilino—, y esta página es de **la plataforma** que
 * la aloja. Son dos productos distintos con dos audiencias distintas; mezclar
 * sus navegaciones confundiría a las dos.
 */
export default async function PlataformaLayout({
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
