import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/marketing/page-header";
import { BrandsMarquee } from "@/components/marketing/brands-marquee";
import { CTA } from "@/components/marketing/cta";

export default async function MarcasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.brandsPage");
  const nav = await getTranslations("nav");

  return (
    <>
      <PageHeader eyebrow={nav("brands")} title={t("title")} lead={t("lead")} />
      <BrandsMarquee />
      <CTA />
    </>
  );
}
