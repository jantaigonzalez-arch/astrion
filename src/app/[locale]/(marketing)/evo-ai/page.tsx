import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Microscope,
  TrendingUp,
  BrainCircuit,
  FileText,
  Code2,
  Server,
  Check,
  CircleCheck,
  Atom,
  ShieldCheck,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { CTA } from "@/components/marketing/cta";
import { EvoAiHero } from "@/components/marketing/evo-ai/hero";
import { EvoAiPipeline } from "@/components/marketing/evo-ai/pipeline";
import { ProcessedSignal } from "@/components/marketing/evo-ai/processed-signal";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.evoAi" });
  return { title: `Evo_AI — ${t("titleAccent")}`, description: t("subtitle") };
}

const FEATURE_ICONS = [
  Microscope,
  TrendingUp,
  BrainCircuit,
  FileText,
  Code2,
  Server,
];

const STACK = [
  "Next.js 16",
  "FastAPI",
  "Python 3.11",
  "SciPy",
  "scikit-learn",
  "Plotly.js",
  "TanStack Table",
  "ReportLab",
  "Docker",
  "Nginx",
];

type Item = { name: string; desc: string };
type Stat = { value: string; label: string };

export default async function EvoAiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages.evoAi");

  const stats = t.raw("stats.items") as Stat[];
  const problemPoints = t.raw("problem.points") as string[];
  const problemTags = t.raw("problem.tags") as string[];
  const features = t.raw("features.items") as Item[];
  const methods = t.raw("ml.methods") as Item[];
  const compliancePoints = t.raw("compliance.points") as string[];

  return (
    <>
      <EvoAiHero />

      {/* Problema → señal cruda */}
      <section className="border-b border-border py-24">
        <Container className="grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("problem.eyebrow")}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-signal/15 text-primary ring-1 ring-inset ring-border">
                <Atom className="size-6" />
              </span>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("problem.kicker")}
              </h2>
            </div>

            <div className="mt-4 flex items-center gap-3 text-sm font-medium text-primary">
              {problemTags.map((tag, i) => (
                <span key={tag} className="flex items-center gap-3">
                  {i > 0 && <span className="text-border">|</span>}
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {problemPoints.map((p) => (
                <div
                  key={p}
                  className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 p-4"
                >
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-sm text-muted-foreground">{p}</span>
                </div>
              ))}
            </div>

            <a
              href="#pipeline"
              className="mt-8 inline-block text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
            >
              {t("problem.link")} →
            </a>
          </Reveal>

          <Reveal delay={0.1}>
            <ProcessedSignal />
          </Reveal>
        </Container>
      </section>

      {/* Banda de métricas */}
      <section className="border-b border-border bg-secondary/30">
        <Container className="py-14">
          <Reveal>
            <p className="text-center text-sm font-medium text-muted-foreground">
              {t("stats.lead")}
            </p>
          </Reveal>
          <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {stats.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.08} className="text-center">
                <div className="font-mono text-2xl font-semibold text-gradient-brand sm:text-3xl">
                  {s.value}
                </div>
                <div className="mt-1.5 text-sm text-muted-foreground">
                  {s.label}
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Pipeline */}
      <EvoAiPipeline />

      {/* Capacidades */}
      <section className="border-b border-border py-24">
        <Container>
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("features.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("features.title")}
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              {t("features.subtitle")}
            </p>
          </Reveal>

          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? Microscope;
              return (
                <Reveal key={f.name} delay={(i % 3) * 0.08}>
                  <div className="group h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-signal/15 text-primary ring-1 ring-inset ring-border transition-transform group-hover:scale-105">
                      <Icon className="size-5" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold">{f.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </section>

      {/* Machine learning */}
      <section className="relative overflow-hidden border-b border-border py-24">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-20 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_65%)]" />
        <Container className="relative">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("ml.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("ml.title")}
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              {t("ml.body")}
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {methods.map((m, i) => (
              <Reveal key={m.name} delay={i * 0.1}>
                <div className="h-full rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="size-4 text-signal" />
                    <span className="font-mono text-sm font-semibold">
                      {m.name}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{m.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Cumplimiento farmacéutico */}
      <section className="border-b border-border py-24">
        <Container className="grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-primary">
              <ShieldCheck className="size-4" /> {t("compliance.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("compliance.title")}
            </h2>
            <p className="mt-5 text-pretty text-lg text-muted-foreground">
              {t("compliance.body")}
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {compliancePoints.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                    <Check className="size-3.5" />
                  </span>
                  <span className="text-sm text-muted-foreground">{p}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      {/* Stack técnico */}
      <section className="border-b border-border py-20">
        <Container className="text-center">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("stack.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("stack.title")}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {STACK.map((tech) => (
                <span
                  key={tech}
                  className="rounded-lg border border-border bg-card px-4 py-2 font-mono text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {tech}
                </span>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      <CTA />
    </>
  );
}
