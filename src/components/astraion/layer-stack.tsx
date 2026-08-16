"use client";

import { Fragment, useEffect, useRef, useState } from "react";

export type Layer = { n: string; name: string; body: string };

/**
 * La arquitectura como objeto: tres planos que llegan separados y se integran
 * en una sola pila.
 *
 * Vive en el encabezado porque es la tesis del producto —tres capas en un
 * sistema—, y una pila que se ensambla lo dice antes que cualquier párrafo.
 *
 * La animación ES el argumento: las capas no conviven, se apoyan. Entran de
 * abajo hacia arriba —primero los datos, luego la historia, al final la
 * inteligencia— porque ese orden es la dependencia, no una preferencia.
 */
export function LayerDeck({
  styles,
  layers,
}: {
  styles: Record<string, string>;
  layers: readonly Layer[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer = 0;
    const start = () => {
      timer = window.setTimeout(() => setLive(true), 260);
    };

    // Sin IntersectionObserver la pila se quedaría invisible, que es peor que
    // animarla fuera de tiempo: se ensambla de inmediato.
    if (!("IntersectionObserver" in window)) {
      start();
      return () => clearTimeout(timer);
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <figure
      ref={ref}
      className={`${styles.arch} ${live ? styles.archLive : ""}`}
      // Las capas se nombran otra vez, en texto, en la sección de arquitectura:
      // aquí basta con anunciar qué es el objeto.
      aria-label={layers.map((l) => `${l.n} ${l.name}`).join(" · ")}
    >
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.deck}>
          {layers.map((l) => (
            <div key={l.n} className={`${styles.plane} ${styles[`plane${l.n}`]}`}>
              <span className={styles.planeEdge} />
              {/* El rótulo va sobre la lámina, pero se endereza: el envoltorio
                  contrarresta el giro y el escorzo del escenario —incluido el
                  giro continuo— para que el texto se lea recto y quieto
                  mientras la pila da la vuelta debajo. */}
              <span className={styles.planeLabel}>
                <span className={styles.planeChip}>
                  <b>{l.n}</b>
                  {l.name}
                </span>
              </span>
            </div>
          ))}

          {/* Las flechas que juntan: entran desde fuera y se cierran sobre la
              pila mientras las láminas se asientan. */}
          <i className={`${styles.joiner} ${styles.joinerN}`} />
          <i className={`${styles.joiner} ${styles.joinerE}`} />
          <i className={`${styles.joiner} ${styles.joinerS}`} />
          <i className={`${styles.joiner} ${styles.joinerW}`} />
        </div>
      </div>
    </figure>
  );
}

/**
 * Las mismas tres capas, nombradas. Acompañan al pronóstico en la sección de
 * arquitectura: la pila del encabezado enseña la forma, esto dice qué es cada
 * una y dónde se detienen los demás.
 */
export function LayerRows({
  styles,
  layers,
  ceiling,
}: {
  styles: Record<string, string>;
  layers: readonly Layer[];
  ceiling: string;
}) {
  return (
    <ol className={styles.rows}>
      {layers.map((l) => (
        <Fragment key={l.n}>
          <li className={`${styles.row} ${styles[`row${l.n}`]}`}>
            <span className={styles.rowN}>{l.n}</span>
            <h3>{l.name}</h3>
            <p>{l.body}</p>
          </li>

          {/* Entre la 2 y la 1: donde se detienen los demás. */}
          {l.n === "2" && <li className={styles.ceiling}>{ceiling}</li>}
        </Fragment>
      ))}
    </ol>
  );
}
