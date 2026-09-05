"use client";

import { useEffect } from "react";

/**
 * Cambiar el ancho de las columnas arrastrando, y que se quede.
 *
 * ── POR QUÉ NO ES UN COMPONENTE QUE ENVUELVE LA TABLA ─────────────────────
 *
 * Porque habría que reescribir las treinta y cuatro para pasarles las columnas
 * como datos, y el ancho no es un dato de la tabla: es una preferencia de quien
 * mira. Esto se monta una vez, encuentra las tablas que lo pidieron —las que
 * llevan `data-tabla`— y les añade el tirador. Una tabla se apunta con un
 * atributo y sin tocar una sola celda.
 *
 * ── SE GUARDA POR TABLA Y POR PERSONA ─────────────────────────────────────
 *
 * En `localStorage` y no en cookie, al revés que la densidad, y la diferencia
 * está en quién lo necesita: la densidad la lee el SERVIDOR para pintar ya con
 * el relleno correcto, mientras que el ancho lo aplica el navegador sobre una
 * tabla que ya está dibujada. Mandarlo en cada petición sería pagar peso en
 * todas las cargas para algo que solo se usa aquí.
 *
 * La clave lleva el nombre de la tabla porque el ancho que le sirve a alguien
 * en Proveedores no dice nada del que quiere en Cuentas por pagar.
 *
 * ── LOS LÍMITES NO SON DECORACIÓN ─────────────────────────────────────────
 *
 * Mínimo de 64 px: una columna arrastrada a cero desaparece y no hay tirador
 * que la traiga de vuelta —el tirador vive en su borde—, así que sería una
 * pérdida sin deshacer. Y se guarda solo lo que se tocó: las columnas que nadie
 * movió siguen repartiéndose el sitio sobrante, que es lo que hace que la tabla
 * no se rompa al cambiar de pantalla.
 */

const CLAVE = (tabla: string) => `evo:anchos:${tabla}`;
const MINIMO = 64;

type Anchos = Record<number, number>;

function leer(tabla: string): Anchos {
  try {
    const crudo = window.localStorage.getItem(CLAVE(tabla));
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (!v || typeof v !== "object") return {};
    const out: Anchos = {};
    for (const [k, ancho] of Object.entries(v as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && typeof ancho === "number" && ancho >= MINIMO) {
        out[i] = ancho;
      }
    }
    return out;
  } catch {
    // Modo privado, almacenamiento bloqueado: la tabla se dibuja con sus anchos
    // naturales, que es exactamente lo de antes. Se pierde el recuerdo, no la
    // tabla.
    return {};
  }
}

function guardar(tabla: string, anchos: Anchos) {
  try {
    window.localStorage.setItem(CLAVE(tabla), JSON.stringify(anchos));
  } catch {
    /* Ver `leer`: no poder recordar no puede romper el arrastre. */
  }
}

export function AnchosDeColumna() {
  useEffect(() => {
    const tablas = Array.from(
      document.querySelectorAll<HTMLTableElement>("table.tabla-erp[data-tabla]"),
    );
    const limpiezas: Array<() => void> = [];

    for (const tabla of tablas) {
      const nombre = tabla.dataset.tabla;
      if (!nombre) continue;
      const encabezados = Array.from(tabla.querySelectorAll<HTMLElement>("thead th"));
      if (encabezados.length < 2) continue;

      const anchos = leer(nombre);
      /*
        `table-layout: fixed` es lo que hace que un ancho puesto se respete.
        Con el automático, el navegador reparte según el CONTENIDO y un `width`
        es apenas una sugerencia: se arrastra la columna y no pasa nada.

        Solo se fija cuando hay algo guardado. Sin anchos, el reparto automático
        es mejor que cualquiera que se pueda calcular aquí.
      */
      if (Object.keys(anchos).length > 0) {
        tabla.style.tableLayout = "fixed";
        for (const [i, w] of Object.entries(anchos)) {
          const th = encabezados[Number(i)];
          if (th) th.style.width = `${w}px`;
        }
      }

      // La última no lleva tirador: no hay nada a su derecha que ceder sitio, y
      // arrastrarla solo ensancharía la tabla hasta desbordarla.
      encabezados.slice(0, -1).forEach((th, i) => {
        const tirador = document.createElement("span");
        tirador.className = "tabla-tirador";
        tirador.setAttribute("role", "separator");
        tirador.setAttribute("aria-orientation", "vertical");
        tirador.setAttribute("aria-label", "Cambiar el ancho de esta columna");
        th.style.position = "relative";
        th.appendChild(tirador);

        const empezar = (e: PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const desde = e.clientX;
          const inicial = th.getBoundingClientRect().width;
          // Se fija AL EMPEZAR, no al soltar: si no, la primera columna que se
          // arrastra empuja a las demás mientras se mueve el ratón.
          tabla.style.tableLayout = "fixed";
          document.body.classList.add("redimensionando");

          const mover = (ev: PointerEvent) => {
            const w = Math.max(MINIMO, Math.round(inicial + ev.clientX - desde));
            th.style.width = `${w}px`;
          };
          const soltar = () => {
            document.body.classList.remove("redimensionando");
            window.removeEventListener("pointermove", mover);
            window.removeEventListener("pointerup", soltar);
            window.removeEventListener("pointercancel", soltar);
            const guardados = leer(nombre);
            guardados[i] = Math.round(th.getBoundingClientRect().width);
            guardar(nombre, guardados);
          };
          window.addEventListener("pointermove", mover);
          window.addEventListener("pointerup", soltar);
          // Un gesto que el navegador cancela —el dedo sale de la pantalla— no
          // puede dejar la tabla pegada al puntero para siempre.
          window.addEventListener("pointercancel", soltar);
        };

        tirador.addEventListener("pointerdown", empezar);
        limpiezas.push(() => {
          tirador.removeEventListener("pointerdown", empezar);
          tirador.remove();
        });
      });
    }

    return () => limpiezas.forEach((f) => f());
  }, []);

  return null;
}
