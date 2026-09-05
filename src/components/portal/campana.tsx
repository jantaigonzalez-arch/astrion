"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { marcarAvisosLeidos } from "@/lib/actions/avisos";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type AvisoItem = {
  id: string;
  /** A dónde lleva. Lo resuelve el servidor; ver `lib/notificaciones.ts`. */
  href: string;
  reference: string | null;
  title: string;
  body: string | null;
  leido: boolean;
  cuando: string;
};

/**
 * La campana: lo que te falta ver, sin salir de la aplicación.
 *
 * ── LOS LEÍDOS TAMBIÉN SE ENSEÑAN ─────────────────────────────────────────
 *
 * Una campana que solo muestra lo pendiente obliga a recordar lo que ya se vio,
 * y el gesto natural al abrirla es «qué me perdí», no «qué me falta por
 * marcar». Los no leídos se distinguen por el punto y por el fondo; los demás
 * siguen ahí, apagados.
 *
 * ── ABRIRLA NO MARCA NADA ─────────────────────────────────────────────────
 *
 * Marcar al abrir es cómodo y es cómo se pierden los avisos: se abre sin querer
 * mientras se busca otra cosa y el punto rojo desaparece con tres cosas dentro
 * que nadie llegó a leer. Se marca al ENTRAR a un aviso —que es cuando de
 * verdad se vio— o con «Marcar todo», que es una decisión explícita.
 *
 * ── EL CONTEO VIENE DEL SERVIDOR ──────────────────────────────────────────
 *
 * Y no se recalcula aquí a partir de la lista: la lista está recortada a los
 * veinte más recientes y el contador tiene que decir la verdad aunque haya
 * treinta sin leer. Que el número y la lista no salgan del mismo sitio es
 * deliberado.
 */
export function Campana({
  avisos,
  sinLeer,
}: {
  avisos: AvisoItem[];
  sinLeer: number;
}) {
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierta(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierta]);

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-label={
          sinLeer > 0 ? `Avisos: ${sinLeer} sin leer` : "Avisos: no hay nada nuevo"
        }
        aria-expanded={abierta}
        className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Bell className="size-[18px]" />
        {sinLeer > 0 && (
          // El número y no solo el punto: «tres cosas nuevas» y «treinta» piden
          // reacciones distintas, y un punto las cuenta igual.
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-[18px] text-white">
            {sinLeer > 99 ? "99+" : sinLeer}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 top-11 z-50 w-[22rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Avisos</span>
            {sinLeer > 0 && (
              <form action={marcarAvisosLeidos}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Check className="size-3.5" /> Marcar todo
                </button>
              </form>
            )}
          </div>

          {avisos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No hay avisos todavía.
            </p>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
              {avisos.map((a) => (
                <li
                  key={a.id}
                  className={cn("relative", !a.leido && "bg-primary/5")}
                >
                  {/*
                    Entrar al ticket es lo que marca el aviso: es el momento en
                    que de verdad se vio. Va como formulario para que ocurra en
                    el servidor —y sin JavaScript—, y la navegación la hace el
                    enlace de dentro.
                  */}
                  <form action={marcarAvisosLeidos}>
                    <input type="hidden" name="id" value={a.id} />
                    <button
                      type="submit"
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-secondary/60"
                    >
                      <Link
                        href={a.href}
                        className="block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="flex items-start gap-2 text-sm font-medium leading-snug">
                          {!a.leido && (
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                          )}
                          <span className={cn(a.leido && "pl-3.5 text-muted-foreground")}>
                            {a.title}
                          </span>
                        </p>
                        {a.body && (
                          <p className="mt-0.5 line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                            {a.body}
                          </p>
                        )}
                        <p className="mt-1 pl-3.5 text-[11px] text-muted-foreground">
                          {a.cuando}
                        </p>
                      </Link>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
