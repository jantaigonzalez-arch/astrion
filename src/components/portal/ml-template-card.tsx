"use client";

import { useActionState } from "react";
import {
  Beaker,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Rocket,
  Database,
  Activity,
  AlertTriangle,
  Undo2,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  trainAction,
  promoteAction,
  deleteTemplateAction,
  backfillAction,
  type MlState,
} from "@/lib/actions/ml";
import { MlCharts, type ForecastRow } from "@/components/portal/ml-charts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const initial: MlState = { ok: false };

/** Cómo se está portando el modelo contra la realidad, no contra el backtest. */
export type DriftRow = {
  n: number;
  mae: number;
  withinTolerance: number;
  bias: number;
};

export type ModelRow = {
  id: string;
  version: number;
  status: string;
  beatsBaseline: boolean;
  note: string | null;
  trainedAt: string;
  predictions: number;
  outcomes: number;
  mae: number;
  baselineMae: number;
  meanBaselineMae: number;
  improvement: number;
  withinTolerance: number;
  tolerance: number;
  nTrain: number;
  nTest: number;
  /** Lo que el modelo va a estimar, por grupo. */
  forecast: ForecastRow[];
  /** Pares [real, estimado] de la evaluación. Vacío en modelos antiguos. */
  points: Array<[number, number]>;
  drift: DriftRow | null;
  degraded: boolean;
};

export type TemplateCard = {
  id: string;
  label: string;
  question: string;
  unit: string;
  tolerance: number;
  /** De fábrica: no se puede borrar. */
  builtin: boolean;
  samples: number;
  enough: boolean;
  hint: string;
  from: string | null;
  to: string | null;
  models: ModelRow[];
};

const ESTADO: Record<string, { label: string; cls: string }> = {
  production: { label: "En producción", cls: "bg-success/15 text-success ring-success/25" },
  backtested: { label: "Aprobado", cls: "bg-primary/15 text-primary ring-primary/25" },
  rejected: { label: "Rechazado", cls: "bg-destructive/12 text-destructive ring-destructive/25" },
  retired: { label: "Retirado", cls: "bg-muted text-muted-foreground ring-border" },
};

export function MlTemplateCard({ t }: { t: TemplateCard }) {
  const [trainState, train, training] = useActionState(trainAction, initial);
  const [promoState, promote, promoting] = useActionState(promoteAction, initial);
  const [delState, remove, removing] = useActionState(deleteTemplateAction, initial);
  const [fillState, backfill, filling] = useActionState(backfillAction, initial);

  const production = t.models.find((m) => m.status === "production");
  const latest = t.models[0];
  const state =
    trainState.error || trainState.message
      ? trainState
      : delState.error || delState.message
        ? delState
        : fillState.error || fillState.message
          ? fillState
          : promoState;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Beaker className="size-4 shrink-0 text-primary" />
            <h2 className="font-semibold">{t.label}</h2>
            {production && (
              <Badge className={cn("ring-1", ESTADO.production.cls)}>
                {ESTADO.production.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t.question}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Borrar solo aparece donde de verdad se puede: sin modelos y sin ser
              de fábrica. Un botón que siempre falla enseña a ignorar los
              botones. */}
          {!t.builtin && t.models.length === 0 && (
            <form action={remove}>
              <input type="hidden" name="template" value={t.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={removing}
                aria-label="Borrar pregunta"
              >
                {removing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </form>
          )}
          {/* Arranque de la capa de análisis. Solo aparece con un modelo
              sirviendo: sin él no hay nada que emitir, y un botón que siempre
              falla enseña a ignorar los botones. */}
          {production && (
            <form action={backfill}>
              <input type="hidden" name="template" value={t.id} />
              <Button type="submit" variant="ghost" size="sm" disabled={filling}>
                {filling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                Estimar los abiertos
              </Button>
            </form>
          )}
          <form action={train}>
            <input type="hidden" name="template" value={t.id} />
            <Button type="submit" variant="outline" size="sm" disabled={training || !t.enough}>
              {training ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {t.models.length ? "Reentrenar" : "Entrenar"}
            </Button>
          </form>
        </div>
      </div>

      {/* Suficiencia de datos: la pregunta "¿tengo con qué?" va antes que
          "¿funciona?", así que se responde arriba y siempre. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Database className="size-3.5" />
          <span className="font-mono text-foreground">{t.samples}</span> casos
        </span>
        {t.from && t.to && (
          <span className="text-muted-foreground">
            {new Date(t.from).getFullYear()} – {new Date(t.to).getFullYear()}
          </span>
        )}
        <span className={t.enough ? "text-muted-foreground" : "text-warning"}>{t.hint}</span>
      </div>

      {state.error && <p className="mt-3 text-sm text-destructive">{state.error}</p>}
      {state.ok && state.message && (
        <p className="mt-3 text-sm text-muted-foreground">{state.message}</p>
      )}

      {/* Las gráficas van ANTES de las cifras. No es orden estético: quien
          administra la empresa necesita saber qué le va a decir el sistema y
          si puede creerle, y solo después le sirve el error promedio. Al revés
          —como estaba— la pantalla contestaba primero la pregunta que nadie
          había hecho. */}
      {latest && (
        <MlCharts
          unit={t.unit}
          tolerance={(production ?? latest).tolerance || t.tolerance}
          forecast={(production ?? latest).forecast}
          points={(production ?? latest).points}
          nTest={(production ?? latest).nTest}
        />
      )}

      {latest && <Metrics m={production ?? latest} unit={t.unit} />}

      {production && <DriftPanel m={production} unit={t.unit} />}

      {t.models.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Historial de versiones
          </p>
          <ul className="grid gap-2">
            {t.models.map((m) => {
              const e = ESTADO[m.status] ?? ESTADO.retired;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">v{m.version}</span>
                  <Badge className={cn("ring-1", e.cls)}>{e.label}</Badge>
                  <span className="text-muted-foreground">
                    error {m.mae.toFixed(2)} {t.unit} · acierta {m.withinTolerance.toFixed(0)}%
                  </span>
                  {m.predictions > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {m.predictions} predicciones · {m.outcomes} con desenlace
                    </span>
                  )}
                  {m.status === "backtested" && (
                    <form action={promote} className="ml-auto">
                      <input type="hidden" name="modelId" value={m.id} />
                      <Button type="submit" size="sm" variant="accent" disabled={promoting}>
                        {promoting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Rocket className="size-4" />
                        )}
                        Promover
                      </Button>
                    </form>
                  )}
                  {/* Devolver a producción algo retirado pide el motivo en el
                      mismo gesto. No es burocracia: dentro de un año, "por qué
                      volvimos a la v2" es justo lo que nadie va a recordar. */}
                  {m.status === "retired" && (
                    <form action={promote} className="ml-auto flex items-center gap-2">
                      <input type="hidden" name="modelId" value={m.id} />
                      <input
                        name="reason"
                        required
                        placeholder="Motivo de la reactivación"
                        className="h-8 w-56 rounded-md border border-border bg-background px-2 text-xs"
                      />
                      <Button type="submit" size="sm" variant="outline" disabled={promoting}>
                        {promoting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Undo2 className="size-4" />
                        )}
                        Reactivar
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * El resultado del backtest.
 *
 * El error del modelo NUNCA se muestra solo: va siempre pegado al de la línea
 * base. "3,12 h de error" no significa nada por sí mismo — es bueno o inútil
 * según lo que logre predecir siempre la mediana. Separarlos sería dejar que
 * el número se lea como un logro cuando puede no serlo.
 */
function Metrics({ m, unit }: { m: ModelRow; unit: string }) {
  const aprobado = m.status !== "rejected";
  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-2">
        {aprobado ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <p className="text-sm">{m.note}</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Cifra
          label="Error del modelo"
          value={`${m.mae.toFixed(2)} ${unit}`}
          strong
        />
        <Cifra
          label="Predecir la mediana"
          value={`${m.baselineMae.toFixed(2)} ${unit}`}
          hint="el rival honesto"
        />
        <Cifra
          label="Predecir el promedio"
          value={`${m.meanBaselineMae.toFixed(2)} ${unit}`}
          hint="referencia débil"
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Acierta el <span className="font-medium text-foreground">{m.withinTolerance.toFixed(0)}%</span>{" "}
        dentro de ±{m.tolerance} {unit}. Entrenado con {m.nTrain} casos del pasado y
        evaluado contra {m.nTest} posteriores, nunca con los mismos.
      </p>
    </div>
  );
}

/**
 * Cómo se está portando el modelo HOY.
 *
 * El backtest se calculó una vez y ya no cambia: dice cómo habría funcionado el
 * modelo sobre el pasado que existía el día que se entrenó. Este panel es la
 * otra mitad, y es la que avisa cuando entró un cliente grande o cambió el mix
 * de equipos y el número que se le muestra al usuario dejó de valer.
 *
 * Mientras no haya desenlaces suficientes dice "todavía no se sabe" en vez de
 * enseñar una cifra. Un MAE calculado sobre tres casos no es una medición
 * modesta: es ruido con aspecto de dato, y en una pantalla pesa igual que uno
 * bueno.
 */
function DriftPanel({ m, unit }: { m: ModelRow; unit: string }) {
  const d = m.drift;

  if (!d || d.n < 5) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <Activity className="size-3.5 shrink-0" />
        <span>
          {m.predictions === 0
            ? "Sin predicciones emitidas todavía. Empieza a medir con el próximo ticket que entre."
            : `${m.predictions} predicciones emitidas, ${m.outcomes} con desenlace. ` +
              "Hacen falta unas cuantas más para decir si se está degradando."}
        </span>
      </div>
    );
  }

  // La comparación honesta: el mismo estadístico, sobre datos distintos.
  const delta = m.mae > 0 ? ((d.mae - m.mae) / m.mae) * 100 : 0;
  const peor = delta > 0;

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-4",
        m.degraded ? "border-warning/40 bg-warning/5" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        {m.degraded ? (
          <AlertTriangle className="size-4 shrink-0 text-warning" />
        ) : (
          <Activity className="size-4 shrink-0 text-primary" />
        )}
        <p className="text-sm font-medium">
          {m.degraded ? "Se está degradando" : "En producción"}
        </p>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {d.n} desenlaces
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Cifra
          label="Error real"
          value={`${d.mae.toFixed(2)} ${unit}`}
          hint={`${peor ? "+" : ""}${delta.toFixed(0)}% vs. backtest`}
          strong
        />
        <Cifra
          label="En el backtest"
          value={`${m.mae.toFixed(2)} ${unit}`}
          hint="lo que prometía"
        />
        <Cifra
          label="Acierta"
          value={`${d.withinTolerance.toFixed(0)}%`}
          hint={`dentro de ±${m.tolerance} ${unit}`}
        />
      </div>

      {/* El sesgo va aparte del error absoluto porque se decide distinto:
          quedarse corto en horas se paga cotizando de menos, pasarse se paga
          reservando agenda que no se usa. El promedio del error absoluto los
          confunde en un solo número. */}
      <p className="mt-3 text-xs text-muted-foreground">
        {Math.abs(d.bias) < 0.05 * Math.max(d.mae, 1) ? (
          "Sin sesgo apreciable: se equivoca por igual hacia arriba y hacia abajo."
        ) : d.bias > 0 ? (
          <>
            Se queda <span className="font-medium text-foreground">corto</span> en
            promedio {Math.abs(d.bias).toFixed(2)} {unit}: los servicios reales
            llevan más de lo que estima.
          </>
        ) : (
          <>
            Se <span className="font-medium text-foreground">pasa</span> en promedio{" "}
            {Math.abs(d.bias).toFixed(2)} {unit}: estima de más.
          </>
        )}
      </p>
    </div>
  );
}

function Cifra({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-mono", strong ? "text-lg font-semibold" : "text-lg")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
