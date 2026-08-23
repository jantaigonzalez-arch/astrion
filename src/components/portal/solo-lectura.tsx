"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";

/**
 * Corta las escrituras del portal cuando quien mira es personal de Astraion.
 *
 * ── POR QUÉ AQUÍ Y NO EN CADA BOTÓN ────────────────────────────────────────
 *
 * Hay 111 acciones de servidor repartidas en 19 archivos y 50 componentes con
 * formulario. Proteger cada una es una lista que hay que mantener al día para
 * siempre, y que falla en silencio el día que alguien escribe la número 112 —
 * el mismo argumento por el que la solo lectura de verdad la impone Postgres
 * (`default_transaction_read_only`, migración 0023) y no una comprobación por
 * acción.
 *
 * Esto NO es la protección: es la EXPLICACIÓN. La base ya rechaza la escritura;
 * sin esto, el rechazo llegaba como un error crudo —«cannot execute INSERT in a
 * read-only transaction»— después de que la persona llenara un formulario
 * entero. Aquí se detiene antes, y se dice por qué.
 *
 * ── POR QUÉ EN `window` Y EN CAPTURA ───────────────────────────────────────
 *
 * En captura para llegar antes que el manejador del formulario, y en `window`
 * y no en `document` por un detalle que importa: el App Router hidrata sobre
 * `document`, así que React tiene ahí sus propios oyentes. Dos oyentes de
 * captura en el MISMO nodo corren en orden de registro, y el de React se
 * registra primero — el nuestro llegaría tarde. `window` está por encima en el
 * camino de captura, así que siempre va antes.
 *
 * ── LO QUE NO BLOQUEA ──────────────────────────────────────────────────────
 *
 * Lo marcado con `data-permitido`. Hoy es «Volver a Astraion»: no escribe en la
 * empresa, borra una cookie. Sin esa exención el guardia atraparía justamente
 * la salida, y dejaría al operador encerrado en la empresa de un cliente.
 */
export function SoloLectura() {
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    // La marca en la raíz es lo que atenúa los botones. Ver `globals.css`.
    document.documentElement.dataset.soloLectura = "1";

    const alEnviar = (e: Event) => {
      const form = e.target as HTMLElement | null;
      if (form?.closest?.("[data-permitido]")) return;
      e.preventDefault();
      e.stopPropagation();
      setAviso(true);
    };

    window.addEventListener("submit", alEnviar, true);
    return () => {
      window.removeEventListener("submit", alEnviar, true);
      delete document.documentElement.dataset.soloLectura;
    };
  }, []);

  if (!aviso) return null;

  return (
    // Abajo y al centro: es la respuesta a algo que la persona acaba de pulsar,
    // y arriba competiría con la franja que ya dice dónde está.
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border border-warning/40 bg-card px-4 py-3 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-sm text-foreground">
        Estás dentro como personal de Astraion, así que{" "}
        <span className="font-medium">no puedes cambiar nada aquí</span>. Para que
        esto se guarde tiene que hacerlo alguien de la empresa.
      </p>
      <button
        type="button"
        onClick={() => setAviso(false)}
        aria-label="Cerrar"
        className="-mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
