"use client";

import { FlaskConical } from "lucide-react";
import { usePathname } from "@/lib/nav";

/**
 * QUÉ ESTÁ EN BETA, Y POR QUÉ SE DICE EN LA PANTALLA Y NO EN UNA NOTA APARTE.
 *
 * Dos cosas: **Inteligencia** y los **Tableros**. Las dos producen números que
 * nadie capturó —los deducen cruzando módulos, y en el caso de Inteligencia los
 * estima un modelo—, y ahí está la diferencia con el resto del sistema: un
 * ticket o una factura enseñan lo que alguien escribió, esto enseña una
 * conclusión. Una conclusión sin margen declarado se firma igual que un dato, y
 * ese es justo el error que el aviso existe para evitar.
 *
 * ── LO QUE NO ESTÁ EN BETA ────────────────────────────────────────────────
 *
 * Rentabilidad, Informes y Objetivos viven en la misma sección del menú y NO
 * llevan la marca: suman y agrupan lo que hay capturado, sin estimar nada.
 * Marcar la sección entera habría sido más cómodo de escribir y habría dicho una
 * cosa falsa de tres pantallas — y una advertencia que sobra en la mayoría de
 * los casos deja de leerse en el que importa.
 *
 * ── UNA LISTA, NO UNA REGLA DEDUCIDA ──────────────────────────────────────
 *
 * La primera versión lo sacaba del módulo `analisis`, que es la regla que decide
 * quién entra. Salía gratis y arrastraba las tres pantallas que no lo son. Lo
 * que está en beta no es un dominio de permisos: es un par de funciones
 * concretas, y se enumeran.
 */
const RUTAS_BETA = [
  "/admin/inteligencia",
  // Toda la sección Tableros, incluido el compositor y cada tablero suelto.
  "/admin/dashboard",
];

/** ¿Esta dirección es de las que todavía están en beta? */
export function esRutaBeta(href: string): boolean {
  const limpio = href.replace(/^\/(es|en)(?=\/|$)/, "");
  return RUTAS_BETA.some((r) => limpio === r || limpio.startsWith(`${r}/`));
}

export function AvisoBeta() {
  const pathname = usePathname();
  if (!esRutaBeta(pathname)) return null;

  const esInteligencia = pathname.includes("/admin/inteligencia");

  return (
    <div
      role="note"
      className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-xs leading-relaxed text-foreground/80">
        <span className="font-semibold text-warning">Beta.</span>{" "}
        {esInteligencia ? (
          <>
            Esta sección <strong>estima</strong>: sus respuestas las produce un
            modelo a partir de lo que hay capturado, y puede equivocarse sin
            avisar.
          </>
        ) : (
          <>
            Los tableros cruzan datos de todos los módulos y todavía se están
            afinando.
          </>
        )}{" "}
        Sirve para <strong>orientarse</strong>, no para cerrar un mes ni para
        reportar a un tercero: contrasta el número contra su módulo antes de
        tomar una decisión sobre él.
      </p>
    </div>
  );
}

/**
 * La misma marca, del tamaño de una etiqueta, para el título de una sección del
 * menú. Solo se usa donde la sección ENTERA está en beta —hoy, Tableros—; dentro
 * de Análisis la lleva únicamente el renglón de Inteligencia, con el mismo
 * distintivo que ya usaban los tableros sin publicar.
 */
export function EtiquetaBeta() {
  return (
    <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning ring-1 ring-warning/25">
      Beta
    </span>
  );
}
