"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { DotField } from "@/components/marketing/dot-field";
import { RawSignal } from "./raw-signal";

export function EvoAiHero() {
  const t = useTranslations("pages.evoAi");
  const annotations = t.raw("problem.annotations") as string[];

  return (
    <section className="relative overflow-hidden border-b border-border">
      {/* Fondos decorativos — malla + aurora "de futuro" */}
      <DotField className="pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(120%_100%_at_80%_20%,black_25%,transparent_75%)]" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-25 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_60%)]" />
      {/* Aurora: dos halos que respiran y derivan */}
      <div className="pointer-events-none absolute -top-48 left-[62%] h-[520px] w-[880px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand-500)_35%,transparent),transparent)] blur-[120px] animate-aurora" />
      <div className="pointer-events-none absolute top-20 left-[8%] h-80 w-80 rounded-full bg-signal/15 blur-[100px] animate-float" />
      <div className="pointer-events-none absolute bottom-0 right-[12%] h-72 w-72 rounded-full bg-brand-400/12 blur-[110px] animate-float [animation-delay:-8s]" />

      <Container className="relative grid items-center gap-14 py-20 lg:grid-cols-[1.02fr_0.98fr] lg:py-28">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Sparkles className="size-3.5 text-signal" />
            {t("badge")}
          </motion.span>

          {/* Wordmark: la evolución Evo(elution) → Evo_AI */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-6 flex items-baseline font-mono text-5xl font-semibold tracking-tighter sm:text-7xl"
            aria-label="Evo_AI, la evolución de Evoelution"
          >
            <span>Evo</span>
            <motion.span
              aria-hidden
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 0.38 }}
              transition={{ duration: 1.1, delay: 0.7, ease: "easeOut" }}
              className="text-[0.42em] font-normal text-muted-foreground line-through decoration-destructive/50 decoration-2"
            >
              elution
            </motion.span>
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="text-gradient-brand [text-shadow:0_0_34px_color-mix(in_oklch,var(--signal)_55%,transparent)]"
            >
              _AI
            </motion.span>
            <span className="ml-1 animate-pulse text-signal" aria-hidden>
              ▍
            </span>
          </motion.h1>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-5 max-w-xl text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
          >
            {t("title")} <span className="text-gradient-brand">{t("titleAccent")}</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="mt-5 max-w-xl text-pretty text-lg text-muted-foreground"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.28 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Button asChild size="lg" variant="accent">
              <Link href="/contacto">
                {t("cta1")} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#pipeline">{t("cta2")}</a>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <ShieldCheck className="size-4 text-signal" />
            {t("compliance.title")}
          </motion.div>
        </div>

        {/* Mockup del hero: la señal cruda (el "antes") */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <RawSignal annotations={annotations} />
        </motion.div>
      </Container>
    </section>
  );
}
