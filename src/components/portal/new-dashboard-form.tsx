"use client";

import { useActionState, useEffect } from "react";
import { ArrowRight, Loader2, XCircle } from "lucide-react";
import { createDashboardAction } from "@/lib/actions/dashboards";
import { useRouter } from "@/lib/nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const inicial = { ok: false } as Awaited<ReturnType<typeof createDashboardAction>>;

/**
 * El formulario de crear un tablero: un nombre y ya.
 *
 * ── POR QUÉ REDIRIGE DESDE EL CLIENTE ──────────────────────────────────────
 *
 * La acción devuelve el slug en vez de redirigir ella misma, y aquí se navega
 * al compositor. Es a propósito: una acción que redirige no puede devolver un
 * error a la pantalla —el `redirect()` corta la ejecución— y entonces «ese
 * nombre está vacío» tendría que viajar en la URL o perderse. Devolviendo el
 * resultado, los dos caminos —error y éxito— salen del mismo sitio.
 *
 * ── EL MÓDULO DE ORIGEN HACE DOS COSAS ─────────────────────────────────────
 *
 * Si se entró desde el botón de una pantalla sin tablero, ese módulo viaja con
 * el formulario y el tablero nace con los análisis de fábrica de esa pantalla
 * ya puestos —ver `sembrarDesde`—, además de quedar preseleccionado en «dónde
 * sale» del compositor.
 *
 * Lo segundo es una sugerencia y no una atadura: dónde sale se decide con el
 * tablero compuesto delante, y ahí se puede quitar o añadir.
 */
export function NewDashboardForm({ modulo }: { modulo: string | null }) {
  const [state, crear, creando] = useActionState(createDashboardAction, inicial);
  const router = useRouter();

  useEffect(() => {
    if (!state.ok || !state.slug) return;
    const destino = `/admin/dashboard/${state.slug}/componer`;
    router.replace(modulo ? `${destino}?modulo=${modulo}` : destino);
  }, [state, modulo, router]);

  return (
    <Card className="p-5">
      <form action={crear} className="space-y-4">
        {/* El módulo de origen viaja con el formulario: el tablero nace con los
            análisis de fábrica de esa pantalla ya puestos. Ver `sembrarDesde`. */}
        {modulo && <input type="hidden" name="modulo" value={modulo} />}
        <div>
          <label htmlFor="title" className="text-sm font-medium">
            Nombre del tablero
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={120}
            autoFocus
            placeholder="Lo que hay que pagar esta semana"
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>

        {state.error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </p>
        )}

        <Button type="submit" variant="accent" disabled={creando}>
          {creando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4" />
          )}
          Crear y componer
        </Button>
      </form>
    </Card>
  );
}
