"use client";

import { useActionState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Play,
  Trash2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  cleanRejectedModelsAction,
  deleteModelAction,
  deleteQuestionAction,
  issueForecastAction,
  promoteModelAction,
  retireModelAction,
  trainQuestionAction,
  type IntelState,
} from "@/lib/actions/intelligence";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ForecastChart,
  type ForecastRow,
  type HistoryRow,
} from "@/components/portal/forecast-chart";
import { cn } from "@/lib/utils";

const inicial: IntelState = { ok: false };

export type CandidateView = {
  algorithm: string;
  label: string;
  params: Record<string, unknown>;
  val_error: number;
  fitted: boolean;
  skipped_reason: string | null;
};

export type ModelView = {
  id: string;
  version: number;
  status: "backtested" | "production" | "retired" | "rejected";
  algorithm: string;
  note: string | null;
  trainedAt: string;
  metrics: {
    mae?: number;
    baseline_mae?: number;
    baseline_name?: string;
    improvement_pct?: number;
    within_tolerance_pct?: number;
    baseline_within_tolerance_pct?: number;
    n_train?: number;
    n_val?: number;
    n_test?: number;
  };
  leaderboard: CandidateView[];
  warnings: string[];
  periods: number | null;
  hasBlob: boolean;
};

export type QuestionView = {
  slug: string;
  module: string;
  label: string;
  question: string;
  task: string;
  horizon: number;
  grain: string;
  tolerance: number;
  toleranceKind: "absolute" | "relative";
  algorithm: string | null;
  unit: string;
  /** Cuántos periodos hay y cuántos hacen falta. Del perfilado, sin entrenar. */
  readiness: { rows: number; needs: number; warnings: string[] } | null;
  models: ModelView[];
  forecast: ForecastRow[];
  /** Lo ya ocurrido, del perfilado en vivo. Ver `HistoryRow`. */
  history: HistoryRow[];
};

const ESTADO: Record<ModelView["status"], { label: string; cls: string }> = {
  production: { label: "En producción", cls: "bg-success/15 text-success border-success/30" },
  backtested: { label: "Evaluado", cls: "bg-primary/10 text-primary border-primary/30" },
  rejected: { label: "Rechazado", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  retired: { label: "Retirado", cls: "bg-muted text-muted-foreground border-border" },
};

/**
 * Una pregunta configurada, con su historia de modelos y su pronóstico.
 *
 * El orden de la tarjeta responde a las preguntas en el orden en que se hacen:
 *
 *   1 · ¿QUÉ PROMETE? El pronóstico primero, arriba, porque es lo único que
 *       cambia una decisión. Las métricas describen al modelo; el gráfico dice
 *       cuánto se va a facturar el mes que viene.
 *   2 · ¿PUEDO CREERLE? El veredicto y las dos cifras que lo sostienen.
 *   3 · ¿QUIÉN COMPITIÓ? La tabla, porque «ganó XGBoost» esconde lo único
 *       interesante: por cuánto, y si los demás llegaron a presentarse.
 *
 * Al revés —métricas primero— la tarjeta contesta antes la pregunta que nadie
 * hizo.
 */
export function IntelligenceQuestionCard({ q }: { q: QuestionView }) {
  const [entrenado, entrenar, entrenando] = useActionState(trainQuestionAction, inicial);
  const [borrado, borrar, borrando] = useActionState(deleteQuestionAction, inicial);

  const produccion = q.models.find((m) => m.status === "production");
  const ultimo = q.models[0];
  const mostrado = produccion ?? ultimo;
  const margen =
    q.toleranceKind === "relative" ? `±${q.tolerance} %` : `±${q.tolerance} ${q.unit}`;

  const falta = q.readiness ? Math.max(0, q.readiness.needs - q.readiness.rows) : 0;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{q.label}</h3>
            <Badge className="border-border bg-secondary text-secondary-foreground">
              {q.task === "forecast" ? "Pronóstico" : q.task}
            </Badge>
            {q.horizon > 1 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                +{q.horizon} periodos
              </span>
            )}
            {/* Que el algoritmo fuera ELECCIÓN y no búsqueda se dice: cambia
                cómo se lee el resultado. */}
            {q.algorithm && (
              <span className="text-[10px] text-muted-foreground">
                familia fijada: {q.algorithm}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{q.question}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {q.readiness ? `${q.readiness.rows} periodos` : "sin perfilar"} · margen {margen}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <form action={entrenar}>
            <input type="hidden" name="slug" value={q.slug} />
            <Button type="submit" size="sm" disabled={entrenando}>
              {entrenando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {entrenando ? "Entrenando…" : "Entrenar"}
            </Button>
          </form>
          {q.models.length === 0 && (
            <form action={borrar}>
              <input type="hidden" name="slug" value={q.slug} />
              <Button type="submit" variant="ghost" size="sm" disabled={borrando}>
                {borrando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Entrenar tarda minutos. Decirlo antes evita que alguien lo dé por
          colgado y recargue a mitad. */}
      {entrenando && (
        <p className="mt-3 text-xs text-muted-foreground">
          Compiten cinco familias con sus configuraciones sobre todo el
          histórico. Puede tardar un par de minutos.
        </p>
      )}
      <Aviso state={entrenado} />
      <Aviso state={borrado} />

      {/* Lo que se puede decir SIN modelo: cuánta historia falta. */}
      {q.readiness && falta > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Hay {q.readiness.rows} periodos y hacen falta {q.readiness.needs}: faltan{" "}
          {falta}. Con menos de dos años completos no se puede distinguir la
          estacionalidad del ruido.
        </p>
      )}
      {q.readiness?.warnings.map((w) => (
        <p
          key={w}
          className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {w}
        </p>
      ))}

      {/* 1 · Qué promete */}
      {produccion && q.forecast.length > 0 && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4 text-primary" /> Lo que estima
          </h4>
          <ForecastChart history={q.history} forecast={q.forecast} unit={q.unit} />
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {q.forecast.slice(0, 6).map((f) => (
              <li key={f.period} className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">{f.period.slice(0, 7)}</span>
                <span className="font-mono tabular-nums">
                  {f.value.toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                  <span className="ml-1 text-xs text-muted-foreground">{q.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 2 · Si se le puede creer */}
      {mostrado && <Veredicto m={mostrado} q={q} />}

      {/* 3 · Quién compitió */}
      {mostrado && mostrado.leaderboard.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            La competencia · {mostrado.leaderboard.length} candidatos
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tabla-erp w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-normal">candidato</th>
                  <th data-num className="py-1 text-right font-normal">error al elegir</th>
                </tr>
              </thead>
              <tbody>
                {mostrado.leaderboard.map((c, i) => (
                  <tr key={`${c.algorithm}-${i}`} className="border-t border-border">
                    <td className="py-1">
                      {c.label}
                      {!c.fitted && (
                        <span className="ml-2 text-muted-foreground">
                          — {c.skipped_reason}
                        </span>
                      )}
                    </td>
                    <td data-num className="py-1 text-right font-mono tabular-nums">
                      {c.fitted && Number.isFinite(c.val_error)
                        ? c.val_error.toLocaleString("es-MX", { maximumFractionDigits: 1 })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Las versiones. Reentrenar no pisa: cada una queda —hasta que se borra. */}
      {q.models.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {q.models.map((m) => (
            <Version key={m.id} m={m} slug={q.slug} />
          ))}
          <LimpiarRechazados q={q} />
        </div>
      )}
    </Card>
  );
}

function Veredicto({ m, q }: { m: ModelView; q: QuestionView }) {
  const k = m.metrics;
  const aprobado = m.status !== "rejected";
  const margen =
    q.toleranceKind === "relative" ? `±${q.tolerance} %` : `±${q.tolerance} ${q.unit}`;

  return (
    <div
      className={cn(
        "mt-4 rounded-lg border p-4",
        aprobado ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
      )}
    >
      <p className="flex items-start gap-2 text-sm">
        {aprobado ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <span>{m.note}</span>
      </p>

      {k.mae !== undefined && (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Cifra label="Error" value={fmt(k.mae)} hint={q.unit} />
          {/* La línea base LLEVA SU NOMBRE. «Mejora 30 %» sin decir sobre qué no
              se puede interpretar: sobre la mediana global lo consigue
              cualquier cosa, sobre «igual que el mes pasado» ya es un logro. */}
          <Cifra
            label="Respuesta ingenua"
            value={fmt(k.baseline_mae)}
            hint={k.baseline_name ?? ""}
          />
          <Cifra
            label="Mejora"
            value={`${(k.improvement_pct ?? 0).toFixed(1)} %`}
            hint="sobre la ingenua"
          />
          <Cifra
            label={`Dentro de ${margen}`}
            value={`${(k.within_tolerance_pct ?? 0).toFixed(0)} %`}
            hint={`la ingenua ${(k.baseline_within_tolerance_pct ?? 0).toFixed(0)} %`}
          />
        </dl>
      )}

      {k.n_test !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">
          Partición temporal: {k.n_train} periodos para entrenar, {k.n_val} para
          elegir la familia y {k.n_test} para medir. El tramo de medición se usa
          una sola vez, con el ganador ya decidido.
        </p>
      )}

      {m.warnings.map((w) => (
        <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {w}
        </p>
      ))}
    </div>
  );
}

function Version({ m, slug }: { m: ModelView; slug: string }) {
  const [prom, promover, promoviendo] = useActionState(promoteModelAction, inicial);
  const [ret, retirar, retirando] = useActionState(retireModelAction, inicial);
  const [fc, emitir, emitiendo] = useActionState(issueForecastAction, inicial);
  const [bor, borrar, borrando] = useActionState(deleteModelAction, inicial);
  const e = ESTADO[m.status];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-muted-foreground">v{m.version}</span>
      <Badge className={e.cls}>{e.label}</Badge>
      <span className="text-muted-foreground">{m.algorithm}</span>
      {m.metrics.improvement_pct !== undefined && (
        <span className="font-mono tabular-nums text-muted-foreground">
          {m.metrics.improvement_pct.toFixed(1)} %
        </span>
      )}
      {m.periods !== null && m.periods > 0 && (
        <span className="text-muted-foreground">{m.periods} periodos emitidos</span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {/* Un rechazado no ofrece «Promover». No es un permiso que falte: es que
            no aporta, y ofrecer el botón invitaría a discutirlo. */}
        {m.status === "backtested" && (
          <form action={promover}>
            <input type="hidden" name="modelId" value={m.id} />
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" size="sm" variant="outline" disabled={promoviendo}>
              {promoviendo && <Loader2 className="size-3 animate-spin" />}
              Poner a servir
            </Button>
          </form>
        )}
        {m.status === "production" && (
          <>
            <form action={emitir}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="periods" value="6" />
              <Button type="submit" size="sm" variant="outline" disabled={emitiendo}>
                {emitiendo && <Loader2 className="size-3 animate-spin" />}
                Recalcular
              </Button>
            </form>
            <form action={retirar}>
              <input type="hidden" name="modelId" value={m.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={retirando}>
                {retirando && <Loader2 className="size-3 animate-spin" />}
                Retirar
              </Button>
            </form>
          </>
        )}

        {/*
          BORRAR EL ENTRENAMIENTO, en todo lo que NO está sirviendo.

          Entrenar es barato y que salga rechazado es lo normal: se prueba, se
          ajusta, se vuelve a probar. Sin esto la lista de versiones crecía para
          siempre y la única forma de limpiarla era borrar la pregunta entera —o
          sea, tirar también lo que sí sirve.

          En producción no aparece, y no es un permiso que falte: borrarlo se
          lleva sus pronósticos por cascada y dejaría la pregunta anunciando
          números que nadie puede recalcular. Para eso está «Retirar», que es un
          paso deliberado y reversible. El servidor lo vuelve a comprobar; esto
          solo evita ofrecer un botón que va a decir que no.
        */}
        {m.status !== "production" && (
          <form action={borrar}>
            <input type="hidden" name="modelId" value={m.id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={borrando}
              title="Borrar este entrenamiento"
              aria-label={`Borrar el entrenamiento v${m.version}`}
            >
              {borrando ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </Button>
          </form>
        )}
      </div>

      {[prom, ret, fc, bor].map((s, i) =>
        s.error ? (
          <p key={i} className="w-full text-destructive">
            {s.error}
          </p>
        ) : s.message ? (
          <p key={i} className="w-full text-muted-foreground">
            {s.message}
          </p>
        ) : null,
      )}
    </div>
  );
}

function Cifra({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-base tabular-nums">{value}</dd>
      {hint && <dd className="text-[10px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function Aviso({ state }: { state: IntelState }) {
  if (state.error) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        <XCircle className="mt-0.5 size-3.5 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        {state.message}
      </p>
    );
  }
  return null;
}

function fmt(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("es-MX", { maximumFractionDigits: v < 100 ? 2 : 0 });
}

/**
 * «Limpiar los rechazados»: el mismo borrado, en lote.
 *
 * Existe porque el desperdicio se produce en lote. Nadie acumula UN rechazado:
 * se acumulan cinco seguidos afinando la misma pregunta, y quitarlos de uno en
 * uno es exactamente la molestia que hace que nadie los quite.
 *
 * ── APARECE A PARTIR DE DOS ───────────────────────────────────────────────
 *
 * Con uno solo, su propia papelera ya está a la vista dos renglones más arriba,
 * y un botón que hace lo mismo que el de al lado solo obliga a elegir. Con dos o
 * más, el botón de lote es más rápido que el de al lado y por eso se ofrece.
 *
 * Solo toca los rechazados: un modelo retirado fue bueno en su momento y su
 * versión puede ser la explicación de un número que alguien archivó. Uno
 * rechazado no llegó a emitir nada, por definición.
 */
function LimpiarRechazados({ q }: { q: QuestionView }) {
  const [estado, limpiar, limpiando] = useActionState(
    cleanRejectedModelsAction,
    inicial,
  );
  const rechazados = q.models.filter((m) => m.status === "rejected").length;
  if (rechazados < 2) return null;

  return (
    <form action={limpiar} className="flex items-center gap-2 pt-1">
      <input type="hidden" name="slug" value={q.slug} />
      <Button type="submit" size="sm" variant="ghost" disabled={limpiando}>
        {limpiando && <Loader2 className="size-3 animate-spin" />}
        <Trash2 className="size-3.5" />
        Limpiar los {rechazados} rechazados
      </Button>
      {estado.error && <span className="text-xs text-destructive">{estado.error}</span>}
    </form>
  );
}
