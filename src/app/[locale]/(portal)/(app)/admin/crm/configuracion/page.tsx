import { setRequestLocale } from "next-intl/server";
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { ensureDefaultPipeline, getPipelines } from "@/lib/data/crm";
import { getLabels } from "@/lib/data/crm-insights";
import { createStage, deleteStage, moveStage, updateStage } from "@/lib/actions/crm";
import { createLabel, deleteLabel } from "@/lib/actions/crm-extras";
import { LABEL_COLORS, LABEL_COLOR_NAMES, LABEL_STYLES } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default async function CrmSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect({ href: "/admin/crm", locale });
  }

  await ensureDefaultPipeline();
  const [pipelines, labels] = await Promise.all([getPipelines(), getLabels()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Configuración del embudo
        </h1>
        <p className="text-sm text-muted-foreground">
          Define las etapas y su probabilidad de cierre. La probabilidad alimenta
          el pronóstico ponderado del tablero.
        </p>
      </div>

      {pipelines.map((p) => (
        <Card key={p.id} className="p-5">
          <h2 className="text-base font-semibold">{p.name}</h2>

          <ul className="mt-4 space-y-2">
            {p.stages.map((s, i) => (
              <li
                key={s.id}
                className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-secondary/30 p-3"
              >
                <form
                  action={updateStage}
                  className="flex flex-1 flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="id" value={s.id} />
                  <div className="min-w-48 flex-1">
                    <Label htmlFor={`name-${s.id}`}>Etapa {i + 1}</Label>
                    <Input id={`name-${s.id}`} name="name" defaultValue={s.name} required />
                  </div>
                  <div className="w-32">
                    <Label htmlFor={`prob-${s.id}`}>Probabilidad %</Label>
                    <Input
                      id={`prob-${s.id}`}
                      name="probability"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={s.probability}
                    />
                  </div>
                  <div className="w-32">
                    <Label htmlFor={`rot-${s.id}`}>Estanca a los…</Label>
                    <Input
                      id={`rot-${s.id}`}
                      name="rottingDays"
                      type="number"
                      min={0}
                      max={365}
                      defaultValue={s.rottingDays}
                      title="Días sin movimiento antes de marcar el negocio como estancado (0 = desactivado)"
                    />
                  </div>
                  <Button type="submit" variant="outline" size="sm">
                    <Save className="size-3.5" /> Guardar
                  </Button>
                </form>

                <div className="flex items-center gap-1">
                  <form action={moveStage}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="dir" value="up" />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      aria-label="Subir etapa"
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                  </form>
                  <form action={moveStage}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="dir" value="down" />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={i === p.stages.length - 1}
                      aria-label="Bajar etapa"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </form>
                  <form action={deleteStage}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar etapa"
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-muted-foreground">
            Solo se pueden eliminar etapas vacías: mueve antes sus negocios.
          </p>

          {/* Alta de etapa */}
          <form
            action={createStage}
            className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5"
          >
            <input type="hidden" name="pipelineId" value={p.id} />
            <div className="min-w-48 flex-1">
              <Label htmlFor={`new-${p.id}`}>Nueva etapa</Label>
              <Input
                id={`new-${p.id}`}
                name="name"
                required
                placeholder="Ej. Validación técnica"
              />
            </div>
            <div className="w-32">
              <Label htmlFor={`newprob-${p.id}`}>Probabilidad %</Label>
              <Input
                id={`newprob-${p.id}`}
                name="probability"
                type="number"
                min={0}
                max={100}
                defaultValue={50}
              />
            </div>
            <Button type="submit" variant="accent" size="sm">
              <Plus className="size-3.5" /> Agregar
            </Button>
          </form>
        </Card>
      ))}

      {/* Etiquetas */}
      <Card className="p-5">
        <h2 className="text-base font-semibold">Etiquetas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Marcas de color para clasificar negocios en el tablero (urgente,
          licitación, renovación…).
        </p>

        {labels.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {labels.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-1.5 rounded-lg border border-border p-1.5 pl-2.5"
              >
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    LABEL_STYLES[l.color] ?? LABEL_STYLES.primary
                  }`}
                >
                  {l.name}
                </span>
                <form action={deleteLabel}>
                  <input type="hidden" name="id" value={l.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar etiqueta ${l.name}`}
                    className="size-7 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={createLabel}
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5"
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor="label-name">Nueva etiqueta</Label>
            <Input id="label-name" name="name" required placeholder="Ej. Licitación" />
          </div>
          <div className="w-40">
            <Label htmlFor="label-color">Color</Label>
            <select
              id="label-color"
              name="color"
              defaultValue="primary"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {LABEL_COLORS.map((c) => (
                <option key={c} value={c}>
                  {LABEL_COLOR_NAMES[c]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="accent" size="sm">
            <Plus className="size-3.5" /> Crear etiqueta
          </Button>
        </form>
      </Card>
    </div>
  );
}
