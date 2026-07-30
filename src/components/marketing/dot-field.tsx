"use client";

import { useEffect, useRef } from "react";

/**
 * Campo de puntos animado: una malla de puntos cuyo brillo y tamaño ondulan
 * con ondas viajeras radiales (efecto "ripple" / dot-wave, estética AI-native).
 * - Canvas + requestAnimationFrame, escalado a devicePixelRatio (nítido).
 * - Consciente del tema (claro/oscuro) y de prefers-reduced-motion.
 * - Se pausa cuando no está visible (IntersectionObserver) para ahorrar CPU.
 */
export function DotField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let running = true;
    let t = 0;

    const GAP = () => (width < 640 ? 24 : 20); // espaciado de la malla

    function isDark() {
      return document.documentElement.classList.contains("dark");
    }

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height || 480;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      const gap = GAP();
      const dark = isDark();

      // Origen de las ondas: fuera de pantalla a la derecha (como la referencia).
      const ox = width * 1.02;
      const oy = height * 0.3;

      for (let y = gap * 0.5; y < height; y += gap) {
        for (let x = gap * 0.5; x < width; x += gap) {
          const dx = x - ox;
          const dy = y - oy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Dos ondas viajeras → bandas curvas orgánicas que se desplazan.
          const w1 = Math.sin(dist * 0.021 - t * 1.7);
          const w2 = Math.sin((x - y) * 0.006 + t * 0.9);
          const combined = w1 * 0.68 + w2 * 0.32; // -1..1
          // Curva sharpen: los picos brillan y los valles se apagan (bandas nítidas).
          let intensity = combined * 0.5 + 0.5; // 0..1
          intensity = Math.pow(intensity, 1.7);

          // El texto va a la izquierda: calmamos un poco esa zona, sin apagarla.
          const fade = Math.min(1, (x / width) * 1.15 + 0.16);

          const alpha = (0.05 + intensity * 0.85) * fade;
          const r = 0.5 + intensity * 2.0;

          if (dark) {
            ctx!.fillStyle = `rgba(${110 + intensity * 110}, ${205 + intensity * 45}, 255, ${alpha})`;
          } else {
            ctx!.fillStyle = `rgba(${40 + intensity * 20}, ${100 + intensity * 60}, ${230}, ${alpha})`;
          }

          ctx!.beginPath();
          ctx!.arc(x, y, r, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    function loop() {
      if (!running) return;
      t += 0.02;
      draw();
      raf = requestAnimationFrame(loop);
    }

    resize();

    if (reduced) {
      draw(); // sin animación: un solo fotograma
    } else {
      loop();
    }

    const onResize = () => {
      resize();
      if (reduced) draw();
    };
    window.addEventListener("resize", onResize, { passive: true });

    // Pausa cuando el hero no está visible (solo si estamos animando).
    const io = new IntersectionObserver(
      ([entry]) => {
        if (reduced) return;
        if (entry.isIntersecting && !running) {
          running = true;
          loop();
        } else if (!entry.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      io.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
