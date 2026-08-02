"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Medidor de brecha: dos marcadores sobre una escala, y la distancia entre
 * ellos se cierra.
 *
 * La animación ES el argumento de la sección, así que ocurre cuando el lector
 * la está mirando y no antes: se dispara al entrar en pantalla, una sola vez.
 * Adelantarla la convertiría en decoración que ya pasó.
 */
export function GapMeter({
  styles,
  labels,
}: {
  styles: Record<string, string>;
  labels: { small: string; big: string; gap: string };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // El retraso corto separa la entrada en pantalla del arranque: sin él la
    // animación ya está a mitad cuando el ojo llega. Además evita mover el
    // estado dentro del cuerpo síncrono del efecto.
    let timer = 0;
    const close = () => {
      timer = window.setTimeout(() => setClosed(true), 320);
    };

    if (!("IntersectionObserver" in window)) {
      close();
      return () => clearTimeout(timer);
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          close();
        }
      },
      { threshold: 0.55 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.scale} ${closed ? styles.closed : ""}`}
      role="img"
      aria-label={`${labels.small} y ${labels.big}: la ${labels.gap} entre ambas se cierra`}
    >
      <div className={styles.scaleLine} aria-hidden="true">
        {[0, 25, 50, 75, 100].map((p) => (
          <i key={p} style={{ left: `${p}%` }} />
        ))}
      </div>
      <div className={styles.gapSpan} aria-hidden="true" />
      <span className={styles.gapLabel}>{labels.gap}</span>
      <div className={`${styles.marker} ${styles.markerSmall}`}>
        <b aria-hidden="true" />
        <span>{labels.small}</span>
      </div>
      <div className={`${styles.marker} ${styles.markerBig}`}>
        <b aria-hidden="true" />
        <span>{labels.big}</span>
      </div>
    </div>
  );
}
