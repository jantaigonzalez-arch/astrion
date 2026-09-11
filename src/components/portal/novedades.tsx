"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Megaphone } from "lucide-react";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type NovedadVisible = {
  id: string;
  titulo: string;
  texto: string;
  href?: string;
};

/*
  «Ya lo vi» se recuerda en el navegador, por persona: la clave lleva el id de
  quien entra, para que en un equipo compartido lo visto por uno no le apague el
  punto al otro. Es una comodidad, no un dato: si el navegador borra lo guardado,
  lo peor que pasa es que el punto vuelve a salir.

  Con `useSyncExternalStore` y no leyendo en un efecto: así el servidor pinta
  sin punto y el cliente lo pone al hidratar, sin un `setState` en un efecto.
*/
const EVENTO = "evo:novedades";
function leer(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function suscribir(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENTO, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENTO, cb);
  };
}

/**
 * Novedades: lo que cambió en la aplicación, sin interrumpir.
 *
 * Un icono junto a la campana, con punto mientras haya algo sin ver. A
 * diferencia de la campana, ABRIRLA SÍ LO MARCA: aquí la lista entera cabe en el
 * desplegable y abrirlo es leerla; en la campana, cada aviso lleva a otra
 * pantalla y abrir no es haber entrado. Ver `lib/novedades.ts`.
 */
export function Novedades({
  novedades,
  usuario,
}: {
  /** Ya filtradas en el servidor por permisos y vigencia, la más nueva primero. */
  novedades: NovedadVisible[];
  usuario: string;
}) {
  const clave = `evo:novedades:vistas:${usuario}`;
  // Se guardan TODAS las vistas y no solo la última: una novedad agregada el
  // mismo día que otra ya vista tiene que volver a encender el punto.
  const crudo = useSyncExternalStore(suscribir, () => leer(clave), () => null);
  const vistas = useMemo(() => {
    try {
      const v: unknown = JSON.parse(crudo ?? "[]");
      return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [crudo]);
  // Sin punto en el servidor ni antes de hidratar: ahí no se sabe qué se vio.
  const hidratado = useSyncExternalStore(suscribir, () => true, () => false);
  const hayNueva = hidratado && novedades.some((n) => !vistas.has(n.id));

  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierta(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierta(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierta]);

  if (novedades.length === 0) return null;

  function abrir() {
    setAbierta((v) => !v);
    try {
      // Las de ahora más las de antes, con tope: las viejas ya no se enseñan y
      // guardarlas para siempre solo haría crecer la entrada.
      const todas = [...new Set([...novedades.map((n) => n.id), ...vistas])].slice(0, 100);
      window.localStorage.setItem(clave, JSON.stringify(todas));
    } catch {
      /* navegador sin almacenamiento: el punto volverá a salir, nada más */
    }
    window.dispatchEvent(new Event(EVENTO));
  }

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={abrir}
        aria-label={hayNueva ? "Novedades: hay cosas nuevas" : "Novedades"}
        aria-expanded={abierta}
        title="Novedades"
        className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Megaphone className="size-[18px]" />
        {hayNueva && (
          // Un punto y no un número: son novedades, no pendientes.
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-card" />
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 top-11 z-50 w-[22rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Novedades</span>
          </div>
          <ul className="max-h-[24rem] divide-y divide-border overflow-y-auto">
            {novedades.map((n) => (
              <li key={n.id} className="px-4 py-3">
                <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.texto}</p>
                {n.href && (
                  <Link
                    href={n.href}
                    onClick={() => setAbierta(false)}
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline",
                    )}
                  >
                    Ir <ArrowRight className="size-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
