import { setRequestLocale } from "next-intl/server";
import { History } from "lucide-react";
import { auth } from "@/lib/auth";
import { getPlatformEvents } from "@/lib/data/platform";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * La bitácora de la plataforma.
 *
 * Sección propia porque es la respuesta a «quién vio los datos de mi empresa y
 * cuándo», y ésa es una pregunta que se viene a buscar — no algo que se lea de
 * paso al final de otra pantalla, que es donde estaba.
 *
 * La ve también soporte, a propósito: quien entra a la empresa de un cliente
 * tiene que poder ver que su propio acceso quedó registrado. Un registro que
 * solo puede leer el jefe se parece demasiado a un registro que no existe.
 */
export default async function BitacoraPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Ver la nota de `empresas/page.tsx`: layout y página corren en paralelo.
  const session = await auth();
  if (!session?.user) return null;

  // 100 y no las 25 de antes: dejó de compartir pantalla con todo lo demás, así
  // que ya no hay razón para cortarla tan pronto.
  const events = await getPlatformEvents(100);

  const cuando = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <History className="size-6 text-primary" />
          Bitácora de la plataforma
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Altas de empresa, accesos del equipo y cambios de consentimiento. Es la
          respuesta a «quién vio los datos de mi empresa y cuándo».
        </p>
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Cuándo</th>
                <th className="py-2 pr-4 font-medium">Evento</th>
                <th className="py-2 pr-4 font-medium">Empresa</th>
                <th className="py-2 font-medium">Quién</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    Sin movimientos registrados.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {cuando.format(new Date(e.occurredAt))}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={cn(
                        "font-mono text-xs",
                        e.eventType === "tenant.accessed_by_platform" && "text-warning",
                      )}
                    >
                      {e.eventType}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{e.tenantName ?? "—"}</td>
                  <td className="py-2 text-muted-foreground">
                    {/* «sistema» cuando no hay actor: son las altas que dispara
                        una migración o un script, no una persona. */}
                    {e.actorName ?? e.actorEmail ?? "sistema"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
