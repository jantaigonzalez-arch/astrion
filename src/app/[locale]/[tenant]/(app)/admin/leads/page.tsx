import { setRequestLocale } from "next-intl/server";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { getLeads } from "@/lib/data/tickets";
import { ensureDefaultPipeline, getConvertedLeadIds, getPipelines } from "@/lib/data/crm";
import { convertLeadToDeal } from "@/lib/actions/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { puedeEn } from "@/lib/tenancy/context";

const LEAD_STYLES: Record<string, string> = {
  new: "bg-primary/12 text-primary ring-primary/20",
  contacted: "bg-signal/15 text-signal-bright ring-signal/25",
  qualified: "bg-warning/15 text-warning ring-warning/25",
  won: "bg-success/15 text-success ring-success/25",
  lost: "bg-muted text-muted-foreground ring-border",
};

export default async function AdminLeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Solo el área comercial puede llevar un lead al embudo.
  const canConvert = await puedeEn("ventas", "editar");

  const leads = await getLeads();
  let pipelineId: string | null = null;
  let converted = new Set<string>();
  if (canConvert) {
    await ensureDefaultPipeline();
    const [pipelines, ids] = await Promise.all([
      getPipelines(),
      getConvertedLeadIds(),
    ]);
    pipelineId = pipelines[0]?.id ?? null;
    converted = ids;
  }

  const fmt = (d: Date | string) =>
    new Date(d).toLocaleString(locale === "en" ? "en-US" : "es-MX");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bandeja web</h1>
        <p className="text-sm text-muted-foreground">
          Solicitudes recibidas desde el formulario de contacto.
          {canConvert && " Conviértelas en negocios del embudo comercial."}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Correo</th>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Mensaje</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                {canConvert && <th className="px-4 py-3 font-medium">CRM</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{l.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {l.email}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {l.company ?? "—"}
                  </td>
                  <td className="max-w-sm truncate px-4 py-3 text-muted-foreground">
                    {l.message}
                  </td>
                  <td className="px-4 py-3">{l.score != null ? `${l.score}%` : "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={LEAD_STYLES[l.status] ?? LEAD_STYLES.new}>
                      {l.status}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {fmt(l.createdAt)}
                  </td>
                  {canConvert && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {converted.has(l.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-success">
                          <CheckCircle2 className="size-3.5" /> En el embudo
                        </span>
                      ) : (
                        <form action={convertLeadToDeal}>
                          <input type="hidden" name="leadId" value={l.id} />
                          <input
                            type="hidden"
                            name="pipelineId"
                            value={pipelineId ?? ""}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            <ArrowRightLeft className="size-3.5" /> Convertir
                          </Button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td
                    colSpan={canConvert ? 8 : 7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    Aún no hay leads.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
