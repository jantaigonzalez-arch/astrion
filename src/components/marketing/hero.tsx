"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Chromatogram } from "./chromatogram";
import { DotField } from "./dot-field";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative overflow-hidden">
      {/* Fondos decorativos */}
      <DotField className="pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(120%_100%_at_100%_30%,black_30%,transparent_75%)]" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_60%)]" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px] animate-glow" />

      <Container className="relative grid items-center gap-12 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-signal" />
            </span>
            {t("badge")}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          >
            {t("title")}
            <br />
            <span className="text-gradient-brand">{t("titleAccent")}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-6 max-w-xl text-pretty text-lg text-muted-foreground"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Button asChild size="lg" variant="accent">
              <Link href="/contacto">
                {t("ctaPrimary")} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/servicios">{t("ctaSecondary")}</Link>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <Clock className="size-4 text-signal" /> {t("responseTime")}
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-signal" /> NIST-traceable
            </span>
          </motion.div>
        </div>

        {/* Tarjeta con cromatograma vivo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className="glass rounded-2xl border border-border/70 p-5 shadow-2xl shadow-primary/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-warning/70" />
                <span className="size-2.5 rounded-full bg-success/70" />
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                run_2026-07-20.dat
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-4">
              <Chromatogram className="h-44 w-full" />
              <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-[11px]">
                {[
                  { k: "RT", v: "2.41" },
                  { k: "Área", v: "48,209" },
                  { k: "SNR", v: "312:1" },
                ].map((m) => (
                  <div
                    key={m.k}
                    className="rounded-lg bg-secondary/60 px-3 py-2"
                  >
                    <div className="text-muted-foreground">{m.k}</div>
                    <div className="text-sm font-semibold">{m.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
