import { Sparkles, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * La estimación del modelo sobre este servicio.
 *
 * Tres decisiones de diseño que no son estéticas:
 *
 * · El número NUNCA va solo. Va con su banda (p25–p75) y con cuántos casos
 *   históricos lo sostienen, porque "6 h" leído a secas se toma por un
 *   compromiso y lo que hay detrás es la mediana de un grupo.
 *
 * · Se dice de dónde salió. Si el modelo tuvo que caer al respaldo global
 *   —ningún grupo aplicaba— eso se muestra, en vez de disimularlo: una
 *   estimación sin contexto específico vale mucho menos y quien la lee tiene
 *   derecho a saberlo antes de cotizar con ella.
 *
 * · Cuando ya se conocen las horas reales, se comparan. Es la forma más barata
 *   de que el equipo desarrolle criterio propio sobre cuánto creerle al modelo,
 *   y la única que no depende de que alguien entre al laboratorio a mirarlo.
 */
export type PredictionCardProps = {
  value: number;
  lower: number | null;
  upper: number | null;
  support: number | null;
  unit: string;
  matched: string;
  explain: Array<{ label: string; value: string }>;
  actual: number | null;
  tolerance: number;
};

export function PredictionCard({ p }: { p: PredictionCardProps }) {
  const global = p.matched === "global" || !p.matched;
  const acerto =
    p.actual !== null && Math.abs(p.actual - p.value) <= p.tolerance;

  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" /> Horas estimadas
      </h3>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {p.value.toFixed(1)}
        </span>
        <span className="text-sm text-muted-foreground">{p.unit}</span>
      </div>

      {p.lower !== null && p.upper !== null && (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          rango habitual {p.lower.toFixed(1)} – {p.upper.toFixed(1)} {p.unit}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {global ? (
          <>
            Sin casos parecidos suficientes: es la mediana de{" "}
            <span className="font-medium text-foreground">todo</span> el
            histórico. Tómala como referencia floja.
          </>
        ) : (
          <>
            Mediana de{" "}
            <span className="font-medium text-foreground">{p.support ?? "?"}</span>{" "}
            servicios parecidos
            {p.explain.length > 0 && (
              <>
                {" "}
                ({p.explain.map((e) => e.value).join(" · ")})
              </>
            )}
            .
          </>
        )}
      </p>

      {p.actual !== null && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
            acerto
              ? "bg-success/10 text-success"
              : "bg-warning/10 text-warning",
          )}
        >
          <Target className="size-3.5 shrink-0" />
          <span>
            Llevó{" "}
            <span className="font-mono font-semibold tabular-nums">
              {p.actual.toFixed(1)} {p.unit}
            </span>{" "}
            · {acerto ? "dentro" : "fuera"} de ±{p.tolerance} {p.unit}
          </span>
        </div>
      )}
    </Card>
  );
}
