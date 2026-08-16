"use client";

import { useActionState } from "react";
import { AlertCircle, Lightbulb, Loader2, Lock, RotateCcw } from "lucide-react";
import {
  acceptRecommendationAction,
  resetPlacementAction,
  togglePlacementAction,
  type AnalysisState,
} from "@/lib/actions/analyses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const initial: AnalysisState = { ok: false };

/** Los cuatro tipos, con la misma escala de certeza que usa el asistente. */
const KIND_LABEL: Record<string, string> = {
  finding: "Requiere atención",
  projection: "Lo que viene",
  trend: "Cómo viene",
  forecast: "Lo que estima un modelo",
};

export type ScreenConfig = {
  prefix: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    kind: string;
    watching: string[];
    adminOnly: boolean;
    active: boolean;
    source: "user" | "system" | "factory";
  }>;
};

export type RecommendationView = {
  analysis: string;
  label: string;
  screen: string;
  screenLabel: string;
  because: string;
};

/**
 * La configuración de análisis.
 *
 * Dos decisiones de presentación que no son cosméticas:
 *
 * 1. Cada análisis enseña QUÉ VIGILA, no solo su nombre. Apagar «Avisos de
 *    cuentas por pagar» sin saber que ahí dentro van los anticipos sin imputar
 *    y el saldo vencido es apagar algo a ciegas, y el coste no se ve hasta el
 *    mes que viene.
 *
 * 2. Las propuestas del sistema van ARRIBA y separadas, con su motivo escrito.
 *    Mezcladas con el resto parecerían ajustes ya hechos; y una propuesta sin
 *    motivo es ruido que se aprende a ignorar.
 */
export function AnalysisSettings({
  screens,
  recommendations,
}: {
  screens: ScreenConfig[];
  recommendations: RecommendationView[];
}) {
  return (
    <div className="space-y-6">
      {recommendations.length > 0 && (
        <Card className="border-primary/40 bg-primary/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Lo que propone el sistema</h2>
          </div>
          <div className="grid gap-3">
            {recommendations.map((r) => (
              <RecommendationRow key={`${r.analysis}:${r.screen}`} r={r} />
            ))}
          </div>
        </Card>
      )}

      {screens.map((s) => (
        <Card key={s.prefix} className="p-5">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">{s.label}</h2>
            <code className="font-mono text-xs text-muted-foreground">{s.prefix}</code>
          </div>

          {s.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Ningún análisis colocado aquí.
            </p>
          ) : (
            <div className="mt-4 grid gap-4">
              {s.items.map((it) => (
                <AnalysisRow key={it.id} screen={s.prefix} it={it} />
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function AnalysisRow({
  screen,
  it,
}: {
  screen: string;
  it: ScreenConfig["items"][number];
}) {
  const [toggleState, toggle, toggling] = useActionState(togglePlacementAction, initial);
  const [resetState, reset, resetting] = useActionState(resetPlacementAction, initial);
  const error = toggleState.error ?? resetState.error;

  return (
    <div className="border-t border-border pt-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                it.active ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground line-through"
              }
            >
              {it.label}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {KIND_LABEL[it.kind] ?? it.kind}
            </span>
            {it.adminOnly && (
              <span
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
                title="Solo lo ve un administrador, esté donde esté colocado."
              >
                <Lock className="size-3" />
                administración
              </span>
            )}
            {it.source === "system" && (
              <span className="text-[10px] text-primary">propuesto por el sistema</span>
            )}
          </div>

          <ul className="mt-1.5 text-xs text-muted-foreground">
            {it.watching.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <form action={toggle}>
            <input type="hidden" name="analysis" value={it.id} />
            <input type="hidden" name="screen" value={screen} />
            <input type="hidden" name="active" value={it.active ? "0" : "1"} />
            <Button type="submit" variant="outline" size="sm" disabled={toggling}>
              {toggling && <Loader2 className="size-3 animate-spin" />}
              {it.active ? "Apagar" : "Encender"}
            </Button>
          </form>

          {/* Solo cuando hay algo que restaurar: de fábrica no hay vuelta atrás
              que dar, y un botón que no hace nada enseña que los botones de
              esta pantalla a veces no hacen nada. */}
          {it.source !== "factory" && (
            <form action={reset}>
              <input type="hidden" name="analysis" value={it.id} />
              <input type="hidden" name="screen" value={screen} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={resetting}
                title="Devolver a como viene de fábrica"
              >
                {resetting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RotateCcw className="size-3" />
                )}
              </Button>
            </form>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function RecommendationRow({ r }: { r: RecommendationView }) {
  const [state, accept, pending] = useActionState(acceptRecommendationAction, initial);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {r.label} <span className="font-normal text-muted-foreground">en {r.screenLabel}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{r.because}</p>
        {state.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
      </div>
      <form action={accept}>
        <input type="hidden" name="analysis" value={r.analysis} />
        <input type="hidden" name="screen" value={r.screen} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-3 animate-spin" />}
          Ponerlo
        </Button>
      </form>
    </div>
  );
}
