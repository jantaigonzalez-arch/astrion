import { useTranslations } from "next-intl";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "./reveal";

export function CTA() {
  const t = useTranslations("cta");

  return (
    <section className="py-16">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-brand-500 to-signal px-8 py-16 text-center shadow-2xl shadow-primary/20 sm:px-16">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {t("title")}
              </h2>
              <p className="mt-4 text-pretty text-white/85">{t("subtitle")}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90">
                  <Link href="/login">
                    {t("button")} <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
                >
                  <a href="https://wa.me/525555902555" target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-4" /> {t("secondary")}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
