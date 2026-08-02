import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

/**
 * El sitio del cliente conserva su propia firma en el título. La plantilla de
 * la app es "· Astraion" —es la empresa dueña del producto—, pero las páginas
 * de Evoelution son de Evoelution y deben leerse así.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    // `absolute` para su portada, y plantilla propia para sus subpáginas:
    // sin esto heredarían "· Astraion", que es la dueña del producto y no la
    // empresa de la que habla el sitio.
    title: { absolute: t("evoTitle"), template: "%s · Evoelution" },
    description: t("evoDescription"),
  };
}

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
