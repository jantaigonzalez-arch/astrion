import { setRequestLocale } from "next-intl/server";
import { AlertTriangle, Landmark } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { getSettings, tipoDeCambioDeLaEmpresa } from "@/lib/data/settings";
import { getTipoDeCambio } from "@/lib/data/tipo-de-cambio";
import { hoyEnMexico, sumarDias } from "@/lib/tipo-de-cambio";
import { puedeEn } from "@/lib/tenancy/context";
import { Card } from "@/components/ui/card";
import { CurrencyForm } from "@/components/portal/currency-form";
import { TipoCambioAutomaticoForm } from "@/components/portal/tipo-cambio-automatico-form";

/** `2026-09-10` → `10 sep 2026`, sin pasar por la zona horaria de nadie. */
const dia = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
const pesos = (n: number) =>
  new Intl.NumberFormat("es-MX", { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n);

/**
 * Configuración → Moneda.
 *
 * Arriba lo que se va a usar HOY y de dónde sale, que es la pregunta de quien
 * entra aquí; después el interruptor, el histórico reciente y el manual.
 */
export default async function MonedaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const hoy = hoyEnMexico();
  const [s, efectivo, usd, eur] = await Promise.all([
    getSettings(),
    tipoDeCambioDeLaEmpresa(undefined, hoy),
    getTipoDeCambio(`USD|${hoy}`),
    getTipoDeCambio(`EUR|${hoy}`),
  ]);

  // Si el último FIX tiene más de cinco días, el cargador no está corriendo:
  // un puente largo no pasa de cuatro.
  const atrasado = !!usd.masReciente && usd.masReciente.fecha < sumarDias(hoy, -5);
  const eurPorFecha = new Map(eur.historial.map((c) => [c.fecha, c.valor]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2">
          <Landmark className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Tipo de cambio de hoy</h2>
        </div>

        {efectivo ? (
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              ${pesos(efectivo.valor)}{" "}
              <span className="text-base font-normal text-muted-foreground">MXN por dólar</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {efectivo.fuente === "banxico" ? (
                <>
                  Banxico: FIX del {dia(efectivo.fix!)}, publicado en el Diario Oficial el{" "}
                  {dia(efectivo.publicado!)}.
                </>
              ) : s.tipoCambioAutomatico ? (
                <>Manual, porque no hay dato de Banxico para hoy.</>
              ) : (
                <>Manual: el que fijó la empresa.</>
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay tipo de cambio para hoy. Los negocios en dólares se guardan sin convertir y no
            suman al embudo hasta que lo haya.
          </p>
        )}

        {atrasado && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            El último dato de Banxico es del {dia(usd.masReciente!.fecha)}: la actualización automática
            no está corriendo. Avísale a Astraion.
          </p>
        )}

        <div className="mt-6">
          <TipoCambioAutomaticoForm automatico={s.tipoCambioAutomatico} />
        </div>

        <p className="mt-4 rounded-lg bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
          Cada negocio en dólares guarda el tipo de cambio del día en que se guardó. Cambiar esto no
          mueve los informes de meses ya cerrados.
        </p>
      </Card>

      {usd.historial.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h3 className="font-semibold">Últimos FIX de Banxico</h3>
            <p className="text-xs text-muted-foreground">
              Por fecha de determinación. Cada uno se publica en el Diario Oficial el día hábil
              siguiente.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table data-tabla="tipo-de-cambio" className="tabla-erp w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Fecha</th>
                  <th data-num className="px-5 py-2 text-right font-medium">Dólar</th>
                  <th data-num className="px-5 py-2 text-right font-medium">Euro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usd.historial.map((c) => (
                  <tr key={c.fecha}>
                    <td className="whitespace-nowrap px-5 py-2">{dia(c.fecha)}</td>
                    <td data-num className="px-5 py-2 text-right tabular-nums">{pesos(c.valor)}</td>
                    <td data-num className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                      {eurPorFecha.has(c.fecha) ? pesos(eurPorFecha.get(c.fecha)!) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CurrencyForm usdRate={s.usdRate} automatico={s.tipoCambioAutomatico} />
    </div>
  );
}
