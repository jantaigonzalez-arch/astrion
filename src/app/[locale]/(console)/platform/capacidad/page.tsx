import { setRequestLocale } from "next-intl/server";
import { Brain, Gauge, HardDrive, Info } from "lucide-react";
import { capacidadDePlataforma } from "@/lib/data/platform";
import { espacioEnDisco, pesoDelLago } from "@/lib/analytics/lake";
import { MargenDeDisco } from "@/components/console/margen-de-disco";
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
 * ── UNA CIFRA QUE HUBO QUE CORREGIR ────────────────────────────────────────
 *
 * El primer corte decía que un inquilino maduro ocupa «unos 30 MB, medido
 * contra la base sembrada». El número era real y la conclusión, falsa: la
 * siembra sintética genera 60 eventos de dominio para catorce mil tickets,
 * mientras que el inquilino de verdad lleva 3 062 para seiscientos. La bitácora
 * de auditoría es de SOLO AÑADIR por diseño —ni `--wipe` la toca— y ya es el
 * 30 % del peso de la empresa real.
 *
 * Extrapolar desde la base sembrada habría triplicado a la baja la estimación
 * de cuántos clientes caben. Por eso el gráfico enseña el peso MEDIDO de cada
 * inquilino y no una proyección: la proyección estaba mal y el peso no puede
 * estarlo.
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

  const [cap, lago, disco] = await Promise.all([
    capacidadDePlataforma(),
    pesoDelLago(),
    espacioEnDisco(),
  ]);
  const totalMb = cap.porInquilino.reduce((a, t) => a + t.mb, 0);
  const lagoMb = Math.round((lago.bytes / 1048576) * 10) / 10;

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
            : `${totalMb.toFixed(1)} MB entre todas, bitácora de auditoría incluida — que en el inquilino real ya es el 30 % del peso y crece para siempre, porque es de solo añadir por diseño.`}
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
        EL MARGEN, que es la pregunta que de verdad se hace quien abre esto:
        no «cuánto ocupa cada uno» sino «cuándo tengo que comprar otro
        servidor». Va después del peso porque se apoya en él.

        Si no hay disco medible —no debería pasar, pero `statfs` puede fallar—
        la tarjeta no se dibuja en vez de enseñar ceros: un margen de cero se
        lee como «no cabe nadie más», que es lo contrario de la verdad.
      */}
      {disco ? (
        <MargenDeDisco
          totalBytes={disco.totalBytes}
          libresBytes={disco.libresBytes}
          desdeElVolumen={disco.desdeElVolumen}
          datosMb={totalMb + lagoMb}
          empresas={cap.porInquilino.length}
        />
      ) : null}

      {/*
        LA CAPA DE INTELIGENCIA, QUE FALTABA.

        El primer corte de esta pantalla miraba solo el plano transaccional y
        daba una cifra tranquilizadora de un sistema al que le falta arrancar una
        capa entera: el lago está a cero porque nadie ha corrido el extractor en
        producción, no porque no vaya a crecer. Un tablero de capacidad
        incompleto es igual de engañoso que uno equivocado.

        Va en su propia tarjeta y no como una barra más porque no tiene techo
        conocido: el lago crece con cada extracción y su tamaño depende de cada
        cuánto se extraiga, algo que todavía no se ha decidido. Poner una barra
        contra un techo inventado sería fingir que la pregunta está contestada.
      */}
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Brain className="size-4 text-primary" />
          Capa de inteligencia
        </h2>
        {lago.archivos === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            El lago está <span className="font-medium text-foreground">vacío</span>:
            todavía no se ha extraído nada. Cuando el extractor corra, aquí crecerá
            un parquet por inquilino y por corrida — y ese crecimiento{" "}
            <span className="font-medium text-foreground">no está</span> en las
            barras de arriba, que solo miden la base transaccional.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {lagoMb.toLocaleString("es-MX")} MB
            </span>{" "}
            en {lago.archivos.toLocaleString("es-MX")} archivo(s)
            {lago.parcial ? " (contados hasta el tope; hay más)" : ""}. Crece con
            cada extracción y no tiene techo configurado.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          El entrenamiento corre en el mismo servidor que atiende a los clientes.
          Con dos núcleos, un modelo entrenando mientras veinte empresas trabajan
          no es la máquina ociosa que miden las barras de arriba — es el límite
          que todavía no está medido.
        </p>
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
