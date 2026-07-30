import { Container } from "@/components/ui/container";
import { Reveal } from "./reveal";
import { DotField } from "./dot-field";

export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <DotField className="pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(120%_100%_at_100%_30%,black_25%,transparent_75%)]" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-25 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_60%)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full bg-primary/12 blur-[110px]" />
      <Container className="relative py-20 lg:py-28">
        <Reveal className="max-w-3xl">
          {eyebrow && (
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          {lead && (
            <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
              {lead}
            </p>
          )}
        </Reveal>
      </Container>
    </section>
  );
}
