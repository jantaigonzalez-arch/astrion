import { setRequestLocale } from "next-intl/server";
import { Gauge, HardDrive, Info } from "lucide-react";
import { capacidadDePlataforma } from "@/lib/data/platform";
import { Card } from "@/components/ui/card";
import { OccupancyBars, CountBars } from "@/components/portal/charts";

export const dynamic = "force-dynamic";

/**
 * CUÁNTA PLATAFORMA QUEDA.
 *
 * ── POR QUÉ NO ESTÁ EN LA BIENVENIDA ───────────────────────────────────────
 *
 * Porque la bienvenida de la consola tiene escrito para qué sirve —orientar y
 * repartir, «cuatro cifras, no seis por empresa»— y esto es profundidad de
 * operación: se abre cuando alguien se pregunta si cabe otro cliente, no cada
 * vez que se entra. Meterlo ahí la habría devuelto al inventario del que la
 * sacaron, solo que con un gráfico encima.
 *
 * ── DOS GRÁFICOS Y NO UNO, A PROPÓSITO ─────────────────────────────────────
 *
 * El primero mide OCUPACIÓN: cada renglón contra su propio techo, y lo que se
 * compara es el porcentaje. El segundo mide PESO en megas. Son dos unidades, y
 * meterlas en el mismo gráfico obligaría a un segundo eje escondido — el error
 * de visualización más común que hay, y el que hace que dos barras del mismo
 * largo signifiquen cosas distintas.
 *
 * ── LO QUE NO SALE, SALE DICHO ─────────────────────────────────────────────
 *
 * CPU, memoria y disco del anfitrión no están, y la pantalla lo explica en vez
 * de callarlo. Un tablero de capacidad que esconde sus puntos ciegos hace creer
 * que la respuesta está completa, que es peor que no tenerlo.
 */
export default async function CapacidadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cap = await capacidadDePlataforma();
  const totalMb = cap.porInquilino.reduce((a, t) => a + t.mb, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Gauge className="size-5 text-primary" />
          Capacidad
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuánto de lo que hay está en uso, y cuánto queda antes de tener que
          crecer.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Ocupación</h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Cada renglón contra su propio techo. Ámbar a partir del 70 %, rojo a
          partir del 90 % — y el porcentaje va escrito, para que el aviso no
          dependa solo del color.
        </p>
        <OccupancyBars
          rows={cap.recursos.map((r) => ({
            label: r.etiqueta,
            used: r.usado,
            ceiling: r.techo,
            unit: r.sufijo,
            note: r.nota,
          }))}
        />
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <HardDrive className="size-4 text-primary" />
          Peso de cada empresa
        </h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          {totalMb < 1
            ? "Todavía sin datos que pesar."
            : `${totalMb.toFixed(1)} MB entre todas. Un inquilino con diez años de operación y catorce mil tickets ocupa unos 30 MB, medido contra la base sembrada de pruebas.`}
        </p>
        <CountBars
          rows={cap.porInquilino.map((t) => ({
            label: t.etiqueta,
            value: t.mb,
            sub: "MB",
          }))}
          emptyText="Ninguna empresa aprovisionada todavía."
        />
      </Card>

      {/*
        El punto ciego, a la vista y no en una nota al pie. Quien mire esta
        pantalla para decidir si cabe otro cliente tiene que saber qué NO está
        mirando.
      */}
      <Card className="flex items-start gap-3 border-dashed p-5">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{cap.fueraDeAlcance}</p>
      </Card>
    </div>
  );
}
