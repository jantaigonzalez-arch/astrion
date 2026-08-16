import { setRequestLocale } from "next-intl/server";
import { Mail, Trash2 } from "lucide-react";
import { getEmailTemplates } from "@/lib/data/crm-insights";
import { createEmailTemplate, deleteEmailTemplate } from "@/lib/actions/crm-extras";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default async function EmailTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const templates = await getEmailTemplates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Plantillas de correo
        </h1>
        <p className="text-sm text-muted-foreground">
          Textos reutilizables para el seguimiento comercial. Desde la ficha de
          un negocio se rellenan con sus datos y se abren en tu cliente de
          correo.
        </p>
      </div>

      <Card className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Marcadores disponibles
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <li
              key={p.key}
              className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs"
            >
              <code className="font-mono text-primary">{p.key}</code>
              <span className="ml-1.5 text-muted-foreground">{p.desc}</span>
            </li>
          ))}
        </ul>
      </Card>

      {templates.length > 0 && (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <strong>Asunto:</strong> {t.subject}
                  </p>
                </div>
                <form action={deleteEmailTemplate}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar plantilla"
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-secondary/30 p-3 font-sans text-sm text-muted-foreground">
                {t.body}
              </pre>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Nueva plantilla
        </h2>
        <form action={createEmailTemplate} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tpl-name">Nombre interno</Label>
              <Input
                id="tpl-name"
                name="name"
                required
                placeholder="Ej. Seguimiento tras cotización"
              />
            </div>
            <div>
              <Label htmlFor="tpl-subject">Asunto</Label>
              <Input
                id="tpl-subject"
                name="subject"
                required
                placeholder="Seguimiento a tu cotización — {{organizacion}}"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="tpl-body">Cuerpo</Label>
            <Textarea
              id="tpl-body"
              name="body"
              required
              rows={7}
              placeholder={`Hola {{contacto}}:\n\nTe escribo para dar seguimiento a la propuesta de {{negocio}} por {{valor}}.\n\nQuedo atento a tus comentarios.\n\nSaludos,\n{{yo}}`}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="accent">
              <Mail className="size-4" /> Guardar plantilla
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
