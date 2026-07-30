"use client";

import { motion } from "motion/react";

// Cromatograma animado: los "picos" se dibujan solos — metáfora visual de la marca.
export function Chromatogram({ className }: { className?: string }) {
  const path =
    "M0 150 L60 150 C80 150 85 148 95 140 L110 120 C118 70 126 70 134 118 L150 150 L200 150 C215 150 220 149 228 142 L242 110 C250 55 258 30 268 88 L280 150 L330 150 C345 150 350 149 360 138 L372 100 C380 60 388 62 396 128 L410 150 L480 150";

  return (
    <svg
      viewBox="0 0 480 200"
      className={className}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* baseline */}
      <line x1="0" y1="150" x2="480" y2="150" stroke="var(--border)" strokeWidth="1" />
      {/* área bajo la curva */}
      <motion.path
        d={`${path} L480 200 L0 200 Z`}
        fill="url(#chromo-fill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.4 }}
      />
      {/* trazo de la señal */}
      <motion.path
        d={path}
        stroke="url(#chromo-stroke)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2, ease: "easeInOut" }}
      />
      <defs>
        <linearGradient id="chromo-stroke" x1="0" y1="0" x2="480" y2="0">
          <stop stopColor="var(--brand-500)" />
          <stop offset="1" stopColor="var(--signal-bright)" />
        </linearGradient>
        <linearGradient id="chromo-fill" x1="0" y1="0" x2="0" y2="200">
          <stop stopColor="var(--signal)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--signal)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
