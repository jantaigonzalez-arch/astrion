"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import {
  FileInput,
  Waves,
  Activity,
  LineChart,
  BrainCircuit,
  ArrowRight,
} from "lucide-react";
import { Container } from "@/components/ui/container";

const ICONS = [FileInput, Waves, Activity, LineChart, BrainCircuit];

type Step = { name: string; tag: string; desc: string };

export function EvoAiPipeline() {
  const t = useTranslations("pages.evoAi.pipeline");
  const steps = t.raw("steps") as Step[];

  return (
    <section id="pipeline" className="scroll-mt-20 border-b border-border py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-5 lg:gap-0">
          {steps.map((step, i) => {
            const Icon = ICONS[i] ?? FileInput;
            const last = i === steps.length - 1;
            return (
              <motion.div
                key={step.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                <div className="group relative h-full rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 lg:mx-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-signal/15 text-primary ring-1 ring-inset ring-border">
                      <Icon className="size-5" />
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{step.name}</h3>
                  <span className="mt-2 inline-flex rounded-md bg-secondary/70 px-2 py-0.5 font-mono text-[10px] text-signal ring-1 ring-inset ring-border">
                    {step.tag}
                  </span>
                  <p className="mt-3 text-sm text-muted-foreground">{step.desc}</p>
                </div>

                {/* Conector entre pasos */}
                {!last && (
                  <div className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 py-1 text-border lg:left-full lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:py-0">
                    <ArrowRight className="size-4 rotate-90 text-signal/60 lg:rotate-0" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
