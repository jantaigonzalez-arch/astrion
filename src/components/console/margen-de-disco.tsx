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
 * Dividir el hueco entre el peso de HOY daría un número enorme y falso, y por
 * dos motivos que se descubrieron en este orden:
 *
 *   · la base crece sola. El inquilino de dos años pesa nueve megas y el de diez
 *     rondará los cien, porque la bitácora de auditoría es de solo añadir y ya
 *     es el 30 % de lo que ocupa;
 *   · y la base NO ES LO QUE LLENA EL DISCO. Lo que llena son los adjuntos —
 *     fotos de equipo y comprobantes, topados a 6 MB cada uno—: unos 2 GB al
 *     año en un cliente que los use. A diez años, unos 10 GB, cien veces la
 *     base. Hoy hay UN archivo subido en producción, así que esto es un modelo,
 *     no una medición, y se rotula como tal.
 *
 * Por eso se enseñan las dos cifras y la segunda dice que es proyección.
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
  /** La suma de los cupos vendidos. Es lo que permite ver la sobreventa. */
  cupoTotalMb,
  /** Lo que se espera que pese una empresa madura. Proyección, no medición. */
  maduroMb = 10240,
}: {
  totalBytes: number;
  libresBytes: number;
  desdeElVolumen: boolean;
  datosMb: number;
  empresas: number;
  cupoTotalMb: number;
  maduroMb?: number;
}) {
  const usadoBytes = totalBytes - libresBytes;
  const libresMb = libresBytes / MB;

  // El promedio real de hoy, con suelo: con cero empresas no se divide entre
  // cero, y con una empresa recién creada el promedio sería casi nada y el
  // resultado, un número de fantasía.
  const promedioMb = empresas > 0 ? Math.max(datosMb / empresas, 1) : 0;

  const cabenHoy = promedioMb > 0 ? Math.floor(libresMb / promedioMb) : null;
  const sobreventa = libresMb > 0 ? cupoTotalMb / libresMb : 0;
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

      {/*
        LO PROMETIDO CONTRA LO QUE HAY. El número que faltaba.

        Un cupo por empresa es una PROMESA, y sumarlas dice si se puede cumplir.
        La primera versión de este cupo eran 100 GB por cliente sobre un disco de
        76: con veinte clientes, dos terabytes prometidos sobre cuarenta y tres
        gigas libres. Y lo peor no era la promesa sino que un cupo por encima del
        disco NO SE DISPARA nunca —el disco se llena primero— así que el control
        no habría bloqueado ni una subida.

        Sobrevender espacio es legítimo y lo hace todo el mundo: nadie usa su
        cupo entero. Lo que no es legítimo es no saber cuánto has sobrevendido.
      */}
      {cupoTotalMb > 0 ? (
        <div className="mt-5 rounded-lg bg-secondary/50 px-3 py-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Espacio prometido en cupos</span>
            <span className="tabular-nums">
              <span className="font-semibold text-foreground">
                {(cupoTotalMb / 1024).toFixed(1)} GB
              </span>{" "}
              contra {(libresBytes / GB).toFixed(1)} GB libres
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {sobreventa <= 1
              ? "Cabe entero: aunque todos llenaran su cupo, hay sitio."
              : `Sobrevendido ${sobreventa.toFixed(1)}×. Es normal —nadie usa su cupo entero— pero conviene saberlo: si todos lo llenaran, faltaría espacio.`}
          </p>
        </div>
      ) : null}

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
            empresas más, a {(maduroMb / 1024).toFixed(0)} GB cada una — diez
            años de adjuntos a unos 2 GB al año.{" "}
            <span className="font-medium">Es una proyección</span>, no una
            medición: hoy no hay un solo cliente que adjunte de verdad.
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
