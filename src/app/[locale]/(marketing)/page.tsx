import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/components/marketing/hero";
import { Stats } from "@/components/marketing/stats";
import { Services } from "@/components/marketing/services";
import { WhyUs } from "@/components/marketing/why-us";
import { BrandsMarquee } from "@/components/marketing/brands-marquee";
import { CTA } from "@/components/marketing/cta";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Hero />
      <Stats />
      <Services />
      <WhyUs />
      <BrandsMarquee />
      <CTA />
    </>
  );
}
