import { useTranslations } from "next-intl";
import { Award, Zap, BadgeCheck, Cpu } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Reveal } from "./reveal";

const ITEMS = [
  { key: "experience", Icon: Award },
  { key: "response", Icon: Zap },
  { key: "traceable", Icon: BadgeCheck },
  { key: "automation", Icon: Cpu },
] as const;

export function WhyUs() {
  const t = useTranslations("why");

  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("title")}
            </h2>
          </Reveal>

          <div className="grid gap-5 sm:grid-cols-2">
            {ITEMS.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 0.08}>
                <div className="rounded-2xl border border-border bg-card/70 p-6">
                  <Icon className="size-6 text-signal" />
                  <h3 className="mt-4 font-semibold">{t(`items.${key}.title`)}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(`items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
