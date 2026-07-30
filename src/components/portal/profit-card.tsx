import { TrendingUp, TrendingDown, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { mxn, type Profit } from "@/lib/profit";
import { cn } from "@/lib/utils";

/** Resumen de rentabilidad — información interna, nunca sale en el reporte del cliente. */
export function ProfitCard({
  p,
  title = "Utilidad del servicio",
  compact = false,
}: {
  p: Profit;
  title?: string;
  compact?: boolean;
}) {
  const positive = p.profit >= 0;

  const Line = ({
    k,
    v,
    strong,
    tone,
  }: {
    k: string;
    v: string;
    strong?: boolean;
    tone?: "muted" | "danger" | "success";
  }) => (
    <div className="flex justify-between gap-4 py-1">
      <span className={tone === "muted" ? "text-muted-foreground" : ""}>{k}</span>
      <span
        className={cn(
          "text-right tabular-nums",
          strong && "font-semibold",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {v}
      </span>
    </div>
  );

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {positive ? (
            <TrendingUp className="size-4 text-success" />
          ) : (
            <TrendingDown className="size-4 text-destructive" />
          )}
          {title}
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" /> interno
        </span>
      </div>

      {!compact && (
        <div className="mb-3 space-y-0.5 border-b border-border pb-3 text-sm">
          <Line k="Venta de refacciones" v={mxn(p.partsRevenue)} tone="muted" />
          <Line
            k={`Mano de obra (${p.hours} h)`}
            v={mxn(p.laborRevenue)}
            tone="muted"
          />
          <Line k="Ingreso total" v={mxn(p.revenue)} strong />
          <div className="pt-2" />
          <Line k="Costo de refacciones" v={mxn(p.partsCost)} tone="muted" />
          <Line k="Costo de mano de obra" v={mxn(p.laborCost)} tone="muted" />
          <Line k="Costo total" v={mxn(p.cost)} strong />
        </div>
      )}

      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Utilidad
          </div>
          <div
            className={cn(
              "text-2xl font-semibold tabular-nums",
              positive ? "text-success" : "text-destructive",
            )}
          >
            {mxn(p.profit)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Margen
          </div>
          <div
            className={cn(
              "text-xl font-semibold tabular-nums",
              positive ? "text-success" : "text-destructive",
            )}
          >
            {p.margin.toFixed(1)}%
          </div>
        </div>
      </div>
    </Card>
  );
}
