import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { requireTenant } from "@/lib/tenancy/context";
import { SuscripcionCard } from "@/components/portal/suscripcion-card";
import { Card } from "@/components/ui/card";
import { Database } from "lucide-react";
import { consumoDelPlan } from "@/lib/data/resumen";
import { CountBars } from "@/components/portal/charts";

/**
 * La pestaña de suscripción.
 *
 * Sin guardia propio: el layout de `/admin/configuracion` ya exige administrar
 * ese módulo, y repetirlo aquí sería una segunda lista que mantener al día.
 */
export default async function SuscripcionSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  /*
    GUARDIA PROPIO, y no heredado del layout.

    Colgaba del layout del área, que hasta ahora exigía `configuracion:
    administrar` para todo. Al abrirse el área a quien administra VIÁTICOS —para
    que General llegue a su pestaña— ese listón dejó de proteger esta pantalla:
    sin esta comprobación, General podría abrirla escribiendo la dirección.

    Es exactamente el hueco que el layout documenta haber corregido en su día
    con agentes y vendedores, reaparecido por el otro lado.
  */
  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [ctx, consumo] = await Promise.all([requireTenant(), consumoDelPlan()]);

  return (
    <div className="space-y-6">
      <SuscripcionCard estado={ctx.suscripcion} plan={ctx.plan} />

      {/*
        LO QUE LLEVAS DENTRO, y no «cuánto te queda».

        El plan Tierra no tiene límites —«el sistema completo, sin recortes»— así
        que no hay barra de consumo contra un tope: inventarle uno para que el
        gráfico se viera más completo sería inventar una restricción que nadie
        contrató. Lo que contesta es la pregunta que sí se hace quien mira lo
        que paga: qué hay aquí dentro que es mío.

        Los megas van FUERA del gráfico, en el pie: son otra unidad, y meterlos
        en las mismas barras haría que dos del mismo largo dijeran cosas
        distintas.
      */}
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Database className="size-4 text-primary" />
          Lo que llevas guardado
        </h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Tu operación, en registros. No hay cupos que gastar: el plan incluye el
          sistema completo.
        </p>
        <CountBars
          rows={consumo.registros.map((r) => ({ label: r.etiqueta, value: r.n }))}
          emptyText="Todavía no hay nada capturado."
        />
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          Ocupa{" "}
          <span className="font-medium text-foreground">
            {consumo.megas.toLocaleString("es-MX")} MB
          </span>{" "}
          de base de datos. Los comprobantes y las fotos que subes se guardan
          aparte y no cuentan aquí.
        </p>
      </Card>
    </div>
  );
}
