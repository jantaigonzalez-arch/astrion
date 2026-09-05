"use client";

import { usePathname } from "@/lib/nav";
import { esCapaDeInteligencia } from "@/lib/capa";

/**
 * LA FRONTERA, DIBUJADA.
 *
 * Envuelve el contenido de Inteligencia y de los Tableros y les cambia el tema
 * entero —papel, tinta, tipo de letra de los rótulos, esquinas—. El aspecto vive
 * en `.capa-inteligencia` (`globals.css`); esto solo decide cuándo se aplica y
 * pinta la cabecera que dice dónde está uno.
 *
 * ── POR QUÉ AQUÍ Y NO EN UN `layout.tsx` DE LA RUTA ──────────────────────
 *
 * Porque la capa son DOS ramas del árbol —`/admin/inteligencia` y
 * `/admin/dashboard`— y no hay un layout que cubra las dos sin cubrir también
 * todo lo demás. Un layout por rama significaría dos copias de la cabecera y de
 * la decisión de cuándo pintarla, que es como empiezan a discrepar.
 *
 * ── EL MARGEN NEGATIVO NO ES UN TRUCO SUCIO ──────────────────────────────
 *
 * El `<main>` de fuera trae su propio relleno y su propio fondo. Sin cancelarlos,
 * la capa se pintaría como un recuadro flotando dentro del tema de siempre —un
 * parche—, en vez de ocupar la pantalla y sustituirlo. La frontera tiene que
 * llegar hasta el borde para que se lea como otro sitio y no como un aviso.
 */
export function CapaInteligencia({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!esCapaDeInteligencia(pathname)) return <>{children}</>;

  return (
    <div className="capa-inteligencia -m-6 min-h-[calc(100vh-4rem)] lg:-m-8">
      <CabeceraDeCapa />
      <div className="p-6 lg:p-8">{children}</div>
    </div>
  );
}

/**
 * La cabecera del instrumento.
 *
 * Dice tres cosas y ninguna es decorativa: dónde estás, que esto estima, y para
 * qué NO sirve. Va pegada arriba, con regla a los dos lados, porque es la línea
 * que se cruza — si flotara con margen sería una tarjeta más de la página.
 */
function CabeceraDeCapa() {
  return (
    <header className="capa-inteligencia-marco px-6 py-4 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {/*
            El punto late para decir que hay algo corriendo detrás. No consulta
            el estado del motor a propósito: esta cabecera se pinta en cada
            navegación de la capa y preguntarle al servicio en cada una lo
            convertiría en una dependencia de la barra de título. Quién está vivo
            y quién no lo dice la pantalla de Inteligencia, que ya lo hace y con
            el motivo delante.
          */}
          <span className="capa-latido inline-block size-1.5 rounded-full bg-primary" />
          Capa de inteligencia
        </span>
        <span className="rounded-sm border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
          Beta
        </span>
      </div>
      <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Aquí los números no se capturan: se <strong>estiman</strong> con tu propio
        historial y se <strong>cruzan</strong> entre módulos. Sirven para
        orientarse y decidir antes; no para cerrar un mes ni para reportar a un
        tercero. Contrasta contra el módulo de origen antes de firmar nada.
      </p>
    </header>
  );
}

/**
 * La misma marca, del tamaño de una etiqueta, para el título del grupo del menú.
 *
 * Va en el título y no en cada renglón: lo que está en beta es la capa entera, y
 * repetirlo en cada tablero convierte una advertencia en ruido de fondo.
 */
export function EtiquetaBeta() {
  return (
    <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning ring-1 ring-warning/25">
      Beta
    </span>
  );
}
