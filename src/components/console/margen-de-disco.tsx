import { HardDrive, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { OccupancyBars } from "@/components/portal/charts";

const GB = 1073741824;
const MB = 1048576;

/**
 * CUÁNTO FALTA PARA LLENAR EL DISCO, y cuántos clientes más caben antes.
 *
 * ── LA PREGUNTA QUE ESTO CONTESTA ──────────────────────────────────────────
 *
 * No es «cuánto ocupa cada empresa» —eso ya lo dice el gráfico de peso— sino
 * «¿cuándo tengo que comprar otro servidor?». Se contesta con tres datos que sí
 * se pueden medir: el hueco real del disco, lo que ocupa hoy una empresa, y lo
 * que ocupará cuando lleve años.
 *
 * ── DOS CIFRAS Y NO UNA, PORQUE UN CLIENTE NO ES ESTÁTICO ──────────────────
 *
 * Dividir el hueco entre el peso de HOY daría un número enorme y falso: el
 * inquilino de dos años pesa nueve megas y el de diez pesará cerca de cien,
 * porque la bitácora de auditoría es de solo añadir y ya es el 30 % de lo que
 * ocupa. Así que se enseñan las dos —al peso actual y al peso maduro— y la
 * segunda se rotula como PROYECCIÓN, que es lo que es.
 *
 * ── Y SE DICE QUE EL DISCO NO ES SOLO PARA DATOS ───────────────────────────
 *
 * De lo ocupado, la parte de los clientes es diminuta; el resto son imágenes de
 * Docker, caché de compilación y sistema. Callarlo haría leer «32 GB usados»
 * como «32 GB de clientes», que es un error de dos órdenes de magnitud en la
 * única cifra que decide una compra.
 */
export function MargenDeDisco({
  totalBytes,
  libresBytes,
  desdeElVolumen,
  datosMb,
  empresas,
  /** Lo que se espera que pese una empresa madura. Proyección, no medición. */
  maduroMb = 100,
}: {
  totalBytes: number;
  libresBytes: number;
  desdeElVolumen: boolean;
  datosMb: number;
  empresas: number;
  maduroMb?: number;
}) {
  const usadoBytes = totalBytes - libresBytes;
  const libresMb = libresBytes / MB;

  // El promedio real de hoy, con suelo: con cero empresas no se divide entre
  // cero, y con una empresa recién creada el promedio sería casi nada y el
  // resultado, un número de fantasía.
  const promedioMb = empresas > 0 ? Math.max(datosMb / empresas, 1) : 0;

  const cabenHoy = promedioMb > 0 ? Math.floor(libresMb / promedioMb) : null;
  const cabenMaduras = Math.floor(libresMb / maduroMb);

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <HardDrive className="size-4 text-primary" />
        Cuánto falta para llenar el disco
      </h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        {desdeElVolumen
          ? "Medido sobre el volumen montado, que vive en el disco del servidor."
          : "Medido sobre el disco de esta máquina: no hay volumen montado, así que esto es desarrollo y no dice nada de producción."}
      </p>

      <OccupancyBars
        rows={[
          {
            label: "Disco",
            used: Math.round(usadoBytes / GB),
            ceiling: Math.round(totalBytes / GB),
            unit: "GB",
            note: `Quedan ${(libresBytes / GB).toFixed(1)} GB libres.`,
          },
          {
            label: "De eso, datos de clientes",
            used: Math.round(datosMb),
            ceiling: Math.round(totalBytes / MB),
            unit: "MB",
            note: "El resto son imágenes de Docker, caché de compilación, respaldos y sistema. Los datos de los clientes son la parte pequeña, y por eso el disco no es el techo que primero se toca.",
          },
        ]}
      />

      <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Al peso de hoy
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            {cabenHoy === null ? "—" : `+${cabenHoy.toLocaleString("es-MX")}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            empresas más, a {promedioMb.toFixed(1)} MB cada una. Es el promedio
            MEDIDO, y se queda corto: son empresas jóvenes.
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Si todas maduran
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            +{cabenMaduras.toLocaleString("es-MX")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            empresas más, a {maduroMb} MB cada una — diez años de operación con
            su bitácora. <span className="font-medium">Es una proyección</span>,
            no una medición.
          </p>
        </div>
      </div>

      {/*
        El aviso va SIEMPRE, no solo cuando el disco aprieta: quien mira esta
        pantalla para decidir una compra tiene que saber que el número de arriba
        no es el primero que se agota.
      */}
      <p className="mt-4 flex items-start gap-2 rounded-lg bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          El disco no es el primer techo. Antes llegan las{" "}
          <span className="font-medium">empresas trabajando a la vez</span> —el
          renglón de arriba— y, en cuanto la capa de inteligencia entrene, los dos
          núcleos del servidor. Este número dice cuándo se acaba el espacio, no
          cuándo se acaba la máquina.
        </span>
      </p>
    </Card>
  );
}
