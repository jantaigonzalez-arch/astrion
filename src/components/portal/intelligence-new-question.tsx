"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, ShieldCheck, XCircle } from "lucide-react";
import { createQuestionAction, type IntelState } from "@/lib/actions/intelligence";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const inicial: IntelState = { ok: false };

export type SerieOption = {
  id: string;
  label: string;
  question: string;
  unit: string;
  grain: string;
  tolerance: number;
  tolerance_kind: "absolute" | "relative";
  min_periods: number;
};

export type FamiliaOption = {
  id: string;
  label: string;
  extrapola: boolean;
  explicable: boolean;
  minimo: number;
};

export type ModuloOption = {
  id: string;
  label: string;
  series: SerieOption[];
};

/**
 * Crear una pregunta, empezando por el MÓDULO.
 *
 * El orden del formulario es el orden en que se piensa: dónde trabajo, qué
 * quiero saber, para cuándo, y con cuánta precisión. La familia del modelo va
 * al final y por omisión no se elige — que es lo correcto: nadie entra al ERP
 * pensando «quiero un bosque aleatorio».
 *
 * Lo que el usuario NO puede elegir, y es lo que hace segura a la pantalla:
 *
 *   · el ANCLA TEMPORAL. Vive en el catálogo del servicio, escrita una vez por
 *     quien conoce el esquema. Es el punto exacto por donde se cuela una fuga
 *     de información, y no se ofrece porque no debe ofrecerse.
 *   · el SQL. Se elige de una lista cerrada de series revisadas. Una pregunta
 *     creada desde aquí no puede mirar el futuro por accidente porque no hay
 *     forma de expresarlo.
 */
export function IntelligenceNewQuestion({
  modulos,
  familias,
}: {
  modulos: ModuloOption[];
  familias: FamiliaOption[];
}) {
  const [state, crear, creando] = useActionState(createQuestionAction, inicial);
  const [abierto, setAbierto] = useState(false);
  const [moduloId, setModuloId] = useState(modulos[0]?.id ?? "");
  const [serieId, setSerieId] = useState(modulos[0]?.series[0]?.id ?? "");

  const modulo = modulos.find((m) => m.id === moduloId);
  const serie = modulo?.series.find((s) => s.id === serieId);

  if (!abierto) {
    return (
      <Button variant="outline" onClick={() => setAbierto(true)}>
        <Plus className="size-4" /> Nueva pregunta
      </Button>
    );
  }

  const campo =
    "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold">Nueva pregunta</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Elige dónde trabajas y qué quieres saber. El resto lo resuelve el
        sistema.
      </p>

      <form action={crear} className="mt-4 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Módulo</span>
            <select
              name="module"
              className={campo}
              value={moduloId}
              onChange={(e) => {
                const m = modulos.find((x) => x.id === e.target.value);
                setModuloId(e.target.value);
                setSerieId(m?.series[0]?.id ?? "");
              }}
            >
              {modulos.map((m) => (
                <option key={m.id} value={m.id} disabled={m.series.length === 0}>
                  {m.label}
                  {m.series.length === 0 ? " — sin series todavía" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Qué quieres saber</span>
            <select
              name="subject"
              className={campo}
              value={serieId}
              onChange={(e) => setSerieId(e.target.value)}
            >
              {(modulo?.series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {serie && (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            {serie.question} — se mide en {serie.unit}, por {serie.grain === "month" ? "mes" : serie.grain}.
            Necesita {serie.min_periods} periodos de historia.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Nombre</span>
            <input
              name="label"
              required
              maxLength={120}
              defaultValue={serie?.label ?? ""}
              key={serieId}
              className={campo}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Periodos hacia adelante</span>
            <select name="horizon" className={campo} defaultValue="1">
              {[1, 2, 3, 6, 12].map((h) => (
                <option key={h} value={h}>
                  {h === 1 ? "el siguiente" : `${h} periodos`}
                </option>
              ))}
            </select>
            {/* Se dice por qué son modelos distintos: si no, parece un ajuste
                de visualización y alguien espera cambiarlo sin reentrenar. */}
            <span className="text-[10px] text-muted-foreground">
              Cada horizonte es un modelo aparte, entrenado y medido por
              separado.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium">
              Margen aceptable {serie?.tolerance_kind === "relative" ? "(%)" : `(${serie?.unit ?? ""})`}
            </span>
            <input
              type="number"
              name="tolerance"
              min={1}
              step="any"
              required
              defaultValue={serie?.tolerance ?? 20}
              key={`t-${serieId}`}
              className={campo}
            />
            <span className="text-[10px] text-muted-foreground">
              Define qué cuenta como acierto. Muy estrecho, no acierta nadie;
              muy holgado, aciertan todos y deja de decir algo.
            </span>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Familia del modelo</span>
          <select name="algorithm" className={campo} defaultValue="">
            <option value="">
              Que el sistema elija la mejor (recomendado)
            </option>
            {familias.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
                {!f.extrapola ? " — no extrapola" : ""}
                {f.explicable ? " · explicable" : ""}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">
            Fijarla tiene sentido cuando el número hay que defenderlo en una
            junta, aunque otro modelo acierte un poco más. Queda escrito que fue
            elección y no búsqueda.
          </span>
        </label>

        <input type="hidden" name="task" value="forecast" />
        <input type="hidden" name="target" value="value" />
        <input type="hidden" name="grain" value={serie?.grain ?? "month"} />
        <input
          type="hidden"
          name="toleranceKind"
          value={serie?.tolerance_kind ?? "relative"}
        />
        <input type="hidden" name="question" value={serie?.question ?? ""} />

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          No eliges el ancla temporal ni el SQL: eso vive en el catálogo,
          revisado una vez. Es lo que hace imposible que una pregunta creada
          desde aquí mire el futuro por accidente.
        </p>

        {state.error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={creando || !serie}>
            {creando && <Loader2 className="size-4 animate-spin" />}
            Crear
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
