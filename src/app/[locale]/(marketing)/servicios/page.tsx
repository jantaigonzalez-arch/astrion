import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/marketing/page-header";
import { Services } from "@/components/marketing/services";
import { CTA } from "@/components/marketing/cta";

export default async function ServiciosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.servicesPage");
  const nav = await getTranslations("nav");

  return (
    <>
      <PageHeader eyebrow={nav("services")} title={t("title")} lead={t("lead")} />
      <Services />
      <CTA />
    </>
  );
}
