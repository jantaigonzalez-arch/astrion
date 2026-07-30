import { useTranslations } from "next-intl";
import {
  Wrench,
  ShieldCheck,
  GraduationCap,
  Gauge,
  PackageOpen,
  Headset,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/ui/container";
import { Reveal } from "./reveal";

const ITEMS = [
  { key: "maintenance", Icon: Wrench },
  { key: "validation", Icon: ShieldCheck },
  { key: "training", Icon: GraduationCap },
  { key: "calibration", Icon: Gauge },
  { key: "rental", Icon: PackageOpen },
  { key: "support", Icon: Headset },
] as const;

export function Services() {
  const t = useTranslations("services");

  return (
    <section id="servicios" className="py-24">
      <Container>
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-muted-foreground">{t("subtitle")}</p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map(({ key, Icon }, i) => (
            <Reveal key={key} delay={i * 0.06}>
              <Link
                href="/servicios"
                className="group relative flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
              >
                <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/12 to-signal/12 text-primary ring-1 ring-inset ring-primary/15">
                  <Icon className="size-6" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">
                  {t(`items.${key}.title`)}
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {t(`items.${key}.desc`)}
                </p>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t("learnMore")}{" "}
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
