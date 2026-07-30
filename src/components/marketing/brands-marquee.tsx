import { useTranslations } from "next-intl";
import { Container } from "@/components/ui/container";
import { Reveal } from "./reveal";

// Placeholders de marcas — se reemplazan por logos reales en /public/brands.
const BRANDS = [
  "Waters", "Agilent", "Shimadzu", "Thermo", "PerkinElmer",
  "Sartorius", "Metrohm", "Restek", "Phenomenex", "Hamilton",
  "Mettler Toledo", "Bruker",
];

export function BrandsMarquee() {
  const t = useTranslations("brands");
  const row = [...BRANDS, ...BRANDS];

  return (
    <section className="py-20">
      <Container>
        <Reveal className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-muted-foreground">{t("subtitle")}</p>
        </Reveal>
      </Container>

      <div className="relative mt-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div className="flex w-max animate-marquee gap-4">
          {row.map((b, i) => (
            <div
              key={`${b}-${i}`}
              className="flex h-16 min-w-44 items-center justify-center rounded-xl border border-border bg-card px-8 text-sm font-semibold text-muted-foreground"
            >
              {b}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
