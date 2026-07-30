import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { CTA } from "@/components/marketing/cta";

export default async function ProductosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.products");
  const nav = await getTranslations("nav");

  return (
    <>
      <PageHeader eyebrow={nav("products")} title={t("title")} lead={t("lead")} />
      <Container className="py-20">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <PackageOpen className="size-10 text-primary" />
          <p className="text-muted-foreground">{t("soon")}</p>
        </div>
      </Container>
      <CTA />
    </>
  );
}
