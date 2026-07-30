"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Container } from "@/components/ui/container";

function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const duration = 1400;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);

  return (
    <span ref={ref}>
      {val.toLocaleString("es-MX")}
      {suffix}
    </span>
  );
}

export function Stats() {
  const t = useTranslations("stats");
  const items = [
    { to: 20, suffix: "", label: t("years") },
    { to: 50000, suffix: "+", label: t("services") },
    { to: 10000, suffix: "+", label: t("equipment") },
    { to: 26, suffix: "+", label: t("brands") },
  ];

  return (
    <section className="border-y border-border bg-secondary/30">
      <Container className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        {items.map((it, i) => (
          <motion.div
            key={it.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.5 }}
            className="text-center"
          >
            <div className="text-4xl font-semibold tracking-tight text-gradient-brand sm:text-5xl">
              <Counter to={it.to} suffix={it.suffix} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{it.label}</div>
          </motion.div>
        ))}
      </Container>
    </section>
  );
}
