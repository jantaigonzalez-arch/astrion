"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { createTemplateAction, type MlState } from "@/lib/actions/ml";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Constructor de preguntas.
 *
 * La forma de la pantalla es la forma de la garantía. El usuario elige sobre
 * qué, qué predecir, con qué rasgos y con cuánta tolerancia — y no hay un
 * quinto campo. No existe una caja de texto donde escribir SQL, no se elige la
 * fecha de anclaje, y los rasgos que no están fijados en ese instante
 * simplemente no aparecen en la lista.
 *
 * Es deliberado que la restricción no se explique con avisos. Un formulario que
 * dijera "cuidado, no uses el estado del ticket" dependería de que alguien lea
 * y entienda por qué; este no ofrece la opción.
 */

const initial: MlState = { ok: false };

export type Catalog = {
  subjects: Array<{ id: string; label: string }>;
  targets: Array<{
    id: string;
    subject: string;
    label: string;
    unit: string;
    defaultTolerance: number;
  }>;
  features: Array<{
    id: string;
    subjects: string[];
    label: string;
    safeBecause: string;
  }>;
  maxFeatures: number;
};

const selectCls =
  "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

export function MlTemplateBuilder({ catalog }: { catalog: Catalog }) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(createTemplateAction, initial);

  const [subject, setSubject] = useState(catalog.subjects[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [tolerance, setTolerance] = useState("");

  // Cambiar de sujeto invalida lo elegido después. Es lo correcto: un objetivo
  // de ticket no existe para un equipo, y arrastrarlo dejaría el formulario en
  // un estado que el servidor va a rechazar sin que se vea por qué.
  const targets = useMemo(
    () => catalog.targets.filter((t) => t.subject === subject),
    [catalog.targets, subject],
  );
  const availableFeatures = useMemo(
    () => catalog.features.filter((f) => f.subjects.includes(subject)),
    [catalog.features, subject],
  );

  const chosenTarget = targets.find((t) => t.id === target);
  const unit = chosenTarget?.unit ?? "";
  const full = features.length >= catalog.maxFeatures;
  const valid = Boolean(subject && target && features.length > 0);

  function pickSubject(id: string) {
    setSubject(id);
    setTarget("");
    setFeatures([]);
    setTolerance("");
  }

  function pickTarget(id: string) {
    setTarget(id);
    const t = targets.find((x) => x.id === id);
    if (t) setTolerance(String(t.defaultTolerance));
  }

  function toggleFeature(id: string) {
    setFeatures((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= catalog.maxFeatures
          ? prev
          : [...prev, id],
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Crear pregunta
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Crear una pregunta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Se arma eligiendo, no escribiendo. El laboratorio compila la consulta
            y decide después si tus datos pueden responderla.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X className="size-4" />
        </Button>
      </div>

      <form action={submit} className="mt-4 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field n={1} label="¿Sobre qué?">
            <select
              name="subject"
              value={subject}
              onChange={(e) => pickSubject(e.target.value)}
              className={selectCls}
            >
              {catalog.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field n={2} label="¿Qué quieres predecir?">
            <select
              name="target"
              value={target}
              onChange={(e) => pickTarget(e.target.value)}
              className={selectCls}
            >
              <option value="">Elige…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          n={3}
          label={`¿Con qué agrupar? (hasta ${catalog.maxFeatures})`}
          hint="Solo aparecen los datos que ya se conocen cuando habría que predecir. Los que llegan después no están en la lista."
        >
          <div className="flex flex-wrap gap-2">
            {availableFeatures.map((f) => {
              const on = features.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleFeature(f.id)}
                  disabled={!on && full}
                  title={f.safeBecause}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                    !on && full && "cursor-not-allowed opacity-40",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {features.map((f) => (
            <input key={f} type="hidden" name="features" value={f} />
          ))}
        </Field>

        <Field
          n={4}
          label="¿Cuándo consideras útil la respuesta?"
          hint="Es la mitad del veredicto: un modelo que mejora el error promedio pero acierta menos de la mitad de las veces dentro de este margen se rechaza."
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Si acierta dentro de ±</span>
            <input
              name="tolerance"
              type="number"
              step="0.5"
              min="0.5"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">{unit || "—"}</span>
          </div>
        </Field>

        <Field n={5} label="Nombre">
          <input
            name="label"
            required
            minLength={3}
            maxLength={120}
            placeholder="Horas de una calibración"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </Field>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-primary" />
          <span>
            La consulta la compila el sistema desde bloques revisados. No hay
            forma de anclar la pregunta en el futuro ni de entrenar con un dato
            que todavía no existía.
          </span>
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && state.message && (
          <p className="text-sm text-muted-foreground">{state.message}</p>
        )}

        <div>
          <Button type="submit" size="sm" disabled={pending || !valid}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Crear pregunta
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  n,
  label,
  hint,
  children,
}: {
  n: number;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] text-muted-foreground">
          {n}
        </span>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
