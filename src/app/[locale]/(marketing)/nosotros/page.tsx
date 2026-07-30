import { getTranslations, setRequestLocale } from "next-intl/server";
import { Target, Telescope } from "lucide-react";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { Stats } from "@/components/marketing/stats";
import { WhyUs } from "@/components/marketing/why-us";
import { CTA } from "@/components/marketing/cta";

export default async function NosotrosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.about");
  const nav = await getTranslations("nav");

  return (
    <>
      <PageHeader eyebrow={nav("about")} title={t("title")} lead={t("lead")} />
      <Stats />
      <Container className="py-24">
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-border bg-card p-8">
              <Target className="size-7 text-primary" />
              <h2 className="mt-4 text-xl font-semibold">{t("missionTitle")}</h2>
              <p className="mt-3 text-muted-foreground">{t("mission")}</p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="h-full rounded-2xl border border-border bg-card p-8">
              <Telescope className="size-7 text-signal" />
              <h2 className="mt-4 text-xl font-semibold">{t("visionTitle")}</h2>
              <p className="mt-3 text-muted-foreground">{t("vision")}</p>
            </div>
          </Reveal>
        </div>
      </Container>
      <WhyUs />
      <CTA />
    </>
  );
}
