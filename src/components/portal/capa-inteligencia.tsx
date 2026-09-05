"use client";

import { usePathname } from "@/lib/nav";
import { esCapaDeInteligencia } from "@/lib/capa";
import { Astronauta } from "@/components/portal/astronauta";

/**
 * LA FRONTERA, DIBUJADA.
 *
 * Envuelve el contenido de Inteligencia y de los Tableros. Lo que cambia es
 * MÍNIMO —un baño de color del 2,5 % sobre el mismo fondo— y una cabecera con
 * el astronauta. Ni tipografía distinta, ni paleta distinta, ni un componente
 * tocado.
 *
 * Hubo una versión con tema completo: papel y tinta cálidos, verde de fósforo,
 * rótulos monoespaciados, y de noche fósforo sobre negro. Se veía bien y decía
 * lo que no era — quien entraba no sentía que cruzaba una frontera dentro de su
 * ERP, sentía que se había ido a otra aplicación. La señal fuerte la lleva el
 * casco; el resto se queda como está, y el fondo apenas acompaña.
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
    <header className="capa-inteligencia-marco flex items-start gap-3 px-6 py-4 lg:px-8">
      <Astronauta className="capa-flota mt-0.5 size-8 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-sm font-semibold tracking-tight">
            Capa de inteligencia
          </span>
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning ring-1 ring-warning/25">
            Beta
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Aquí los números no se capturan: se <strong>estiman</strong> con tu
          propio historial y se <strong>cruzan</strong> entre módulos. Sirven para
          orientarse y decidir antes; no para cerrar un mes ni para reportar a un
          tercero. Contrasta contra el módulo de origen antes de firmar nada.
        </p>
      </div>
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
