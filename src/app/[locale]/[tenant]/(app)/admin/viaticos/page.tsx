import { setRequestLocale } from "next-intl/server";
import { Plane, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { conteosViaticos, countViaticos, listViaticos } from "@/lib/data/viaticos";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ESTADO_LABELS, mxnViatico, type ViaticoEstado } from "@/lib/viaticos";
import type { ViaticoFila } from "@/lib/data/viaticos";
import { BotonDescargar } from "@/components/portal/boton-descargar";

export const dynamic = "force-dynamic";

/**
 * La lista de viáticos, que es DOS listas según quién mire.
 *
 * El ingeniero ve los suyos; quien administra los ve todos. Es la misma
 * dirección para los dos —no hay `/admin/viaticos/mios`— porque el trabajo es
 * el mismo y separarlo obligaría a que cada quien aprendiera cuál es su URL.
 *
 * Quién ve qué NO se decide aquí: se le pasa `soloDe` a la consulta, que es el
 * único sitio donde el filtro no se puede olvidar. Ver `data/viaticos.ts`.
 */

/**
 * La tabla de viáticos, pintada dos veces: en curso y archivo.
 *
 * A NIVEL DE MÓDULO y no dentro de la página, aunque solo la use ella. Un
 * componente declarado dentro de otro se vuelve a crear en cada render, así que
 * React lo trata como un tipo distinto y desmonta lo que hubiera dentro. Aquí
 * no rompe nada visible —es una tabla sin estado—, y aun así se declara fuera:
 * la regla no se aprende el día que sí rompe.
 *
 * Recibe TODO lo que usa. Capturar `administra` o `locale` del ámbito de la
 * página sería la forma de que las dos tablas dejaran de leerse igual.
 */
function TablaViaticos({
  filas,
  vacio,
  administra,
  locale,
  meToca,
}: {
  filas: ViaticoFila[];
  vacio: string;
  administra: boolean;
  locale: string;
  meToca: (f: ViaticoFila) => boolean;
}) {
  const tono = (e: ViaticoEstado) =>
    e === "cerrado"
      ? "bg-success/15 text-success ring-success/25"
      : e === "rechazado" || e === "cancelado"
        ? "bg-muted text-muted-foreground ring-border"
        : e === "enviado" || e === "en_revision"
          ? "bg-warning/15 text-warning ring-warning/30"
          : "bg-primary/10 text-primary ring-primary/20";

  const fecha = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
    });

  return (

      <Card className="overflow-hidden">
        {filas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Plane className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {vacio}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Folio</th>
                  <th className="px-4 py-2.5 font-medium">Destino</th>
                  {administra ? (
                    <th className="px-4 py-2.5 font-medium">Ingeniero</th>
                  ) : null}
                  {/*
                    «Asunto» y no «Contrato»: desde la 0028 la columna enseña un
                    contrato o un prospecto, y el rótulo viejo hacía leer los
                    renglones de prospección como contratos que faltan.
                  */}
                  <th className="px-4 py-2.5 font-medium">Asunto</th>
                  {administra ? (
                    <th className="px-4 py-2.5 font-medium">A firma de</th>
                  ) : null}
                  <th className="px-4 py-2.5 font-medium">Fechas</th>
                  <th data-num className="px-4 py-2.5 text-right font-medium">Autorizado</th>
                  <th data-num className="px-4 py-2.5 text-right font-medium">Gastado</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filas.map((v) => (
                  <tr key={v.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/viaticos/${v.id}`}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                      >
                        {v.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{v.destination}</td>
                    {administra ? (
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {v.solicitante ?? "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {v.contractNumber ? (
                        <span className="font-mono">{v.contractNumber}</span>
                      ) : (
                        <>
                          {v.prospecto}
                          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            prospecto
                          </span>
                        </>
                      )}
                    </td>
                    {administra ? (
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {/*
                          El guion es la respuesta correcta para los anteriores
                          a la 0028: no es que falte el dato, es que ahí la
                          firma seguía siendo de cualquiera que administre.
                        */}
                        {v.aprobador ?? "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fecha(v.departsOn)} – {fecha(v.returnsOn)}
                    </td>
                    <td data-num className="px-4 py-2.5 text-right tabular-nums">
                      {v.authorizedMxn ? mxnViatico(Number(v.authorizedMxn)) : "—"}
                    </td>
                    <td data-num className="px-4 py-2.5 text-right tabular-nums">
                      {v.gastos > 0 ? mxnViatico(v.gastadoMxn) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={`ring-1 ${tono(v.status)}`}>
                        {ESTADO_LABELS[v.status]}
                      </Badge>
                      {meToca(v) ? (
                        <span className="ml-2 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Te toca
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
  );
}

export default async function ViaticosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; tenant: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [session, administra] = await Promise.all([
    auth(),
    puedeEn("viaticos", "administrar"),
  ]);
  const soloDe = administra ? null : (session?.user?.id ?? null);

  /*
    DOS LISTAS Y NO UNA.

    Lo abierto sale entero: esconder detrás de un paginador algo que espera
    firma es la forma más segura de que nadie lo firme. El archivo se pagina
    porque crece para siempre. Mismo reparto que cuentas por pagar.
  */
  const sp = await searchParams;
  const pageParams = parsePage(sp);
  const [abiertos, archivo, totalArchivo, conteos] = await Promise.all([
    listViaticos(soloDe, { abiertos: true }),
    listViaticos(soloDe, { cerrados: true }, {
      limit: pageParams.perPage,
      offset: pageParams.offset,
    }),
    countViaticos(soloDe, { cerrados: true }),
    conteosViaticos(soloDe),
  ]);

  /*
    A QUIÉN LE TOCA MOVER CADA RENGLÓN.

    Sin esto, un viático se queda en borrador para siempre: quien lo pidió cree
    que va en camino y quien firma no ve nada que firmar, porque un borrador no
    le llega a nadie. Pasó en la primera prueba del módulo.

    La misma regla que titula la ficha, aplicada a la lista: los dos estados de
    captura son de quien viajó, los dos de firma son de quien administra. Se
    calcula aquí y no en la fila para no repetirlo en cada iteración.

    ── Y DESDE LA 0028, «DE QUIEN ADMINISTRA» YA NO ES CUALQUIERA ────────────

    Si el viático nombra aprobador, solo a él le toca. Sin esta condición la
    marca «Te toca» le habría salido a las seis personas que administran gastos
    en los viáticos de las otras cinco — que es exactamente el ruido que el
    aprobador nombrado vino a quitar, reaparecido en la lista.

    Nulo sigue significando «a cualquiera»: son las filas anteriores a la 0028 y
    ahí la marca vieja es la respuesta correcta.
  */
  const yo = session?.user?.id ?? null;
  const meToca = (f: {
    status: ViaticoEstado;
    solicitanteId: string | null;
    aprobadorId: string | null;
  }) =>
    administra
      ? (f.status === "enviado" || f.status === "en_revision") &&
        f.solicitanteId !== yo &&
        (f.aprobadorId === null || f.aprobadorId === yo)
      : f.status === "borrador" || f.status === "autorizado";

  const porEstado = new Map(conteos.map((c) => [c.k, c.n]));
  const esperandoFirma =
    (porEstado.get("enviado") ?? 0) + (porEstado.get("en_revision") ?? 0);





  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Viáticos</h1>
          <p className="text-sm text-muted-foreground">
            {administra
              ? "Solicitudes de viaje del equipo de servicio y su comprobación."
              : "Tus solicitudes de viaje y la comprobación de tus gastos."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotonDescargar dataset="viaticos" />
          <Button asChild variant="accent">
            <Link href="/admin/viaticos/nuevo">
              <Plus className="size-4" />
              Pedir viáticos
            </Link>
          </Button>
        </div>
      </div>

      {/*
        La ficha de «esperan tu firma» solo la ve quien puede firmar, y solo
        cuando hay algo. Para el ingeniero ese número no es accionable —no es él
        quien firma— y sería una cuenta que mirar sin poder bajarla.
      */}
      {administra && esperandoFirma > 0 ? (
        <Card className="border-warning/30 bg-warning/5 px-5 py-4">
          <p className="text-sm">
            <span className="font-semibold">{esperandoFirma}</span> viático(s)
            esperan tu firma.
          </p>
        </Card>
      ) : null}

      {/* Lo que espera acción: entero, sin paginar. */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          En curso
        </h2>
        <TablaViaticos
          administra={administra}
          locale={locale}
          meToca={meToca}
          filas={abiertos}
          vacio={
            administra
              ? "Nadie tiene viáticos en curso."
              : "No tienes viáticos en curso."
          }
        />
      </div>

      {/* El archivo: crece para siempre, así que se pagina. */}
      {totalArchivo > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Cerrados · {totalArchivo}
          </h2>
          <TablaViaticos
            administra={administra}
            locale={locale}
            meToca={meToca}
            filas={archivo}
            vacio="Nada en el archivo."
          />
          <Pagination
            {...pageParams}
            total={totalArchivo}
            basePath="/admin/viaticos"
          />
        </div>
      ) : null}
    </div>
  );
}
