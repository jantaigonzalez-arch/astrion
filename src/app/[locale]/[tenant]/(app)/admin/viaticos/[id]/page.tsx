import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AlertTriangle, FileText, Plane, Wrench } from "lucide-react";
import { auth } from "@/lib/auth";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { getViatico, ticketsDelContrato } from "@/lib/data/viaticos";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AccionesViatico, QuitarGasto } from "@/components/portal/viaticos/acciones";
import { GastoForm } from "@/components/portal/viaticos/gasto-form";
import {
  CATEGORIA_LABELS,
  ESTADO_LABELS,
  cuadre,
  estaCerrado,
  mxnViatico,
  saldoEnPalabras,
} from "@/lib/viaticos";

export const dynamic = "force-dynamic";

export default async function ViaticoPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [session, administra] = await Promise.all([
    auth(),
    puedeEn("viaticos", "administrar"),
  ]);
  const yo = session?.user?.id ?? null;
  const v = await getViatico(id, administra ? null : yo);
  if (!v) notFound();

  const soyElSolicitante = v.requestedById === yo;
  /*
    PUEDO FIRMAR = puedo administrar Y no soy quien lo pidió.

    La segunda mitad es la que importa y la que se olvida: el administrador que
    además viaja tiene permiso de módulo sobre sus propios viáticos. El servidor
    lo rechaza igual —`firmaValida` en `domain/viaticos.ts`—, y aquí se repite
    para que el botón ni siquiera aparezca. Que la pantalla y el guardia digan
    lo mismo es lo que evita ofrecer una puerta que luego se cierra.
  */
  const puedoFirmar = administra && !soyElSolicitante;

  /*
    ¿La pelota es de quien está mirando?

    Se calcula aquí para poder titular el bloque —«Te toca» contra «En espera»—
    sin duplicar la regla: el componente ya decide QUÉ botones pinta, esto solo
    decide cómo se encabeza. Los dos estados de firma son de quien firma; los
    dos de captura, de quien viajó.
  */
  const leToca =
    (v.status === "borrador" && soyElSolicitante) ||
    (v.status === "enviado" && puedoFirmar) ||
    (v.status === "autorizado" && soyElSolicitante) ||
    (v.status === "en_revision" && puedoFirmar);

  const gastado = v.gastos.reduce((a, g) => a + Number(g.amountMxn), 0);
  const c = cuadre(Number(v.authorizedMxn ?? 0), gastado);
  const sinComprobante = v.gastos.filter((g) => !g.receiptPath).length;
  const puedeCapturar = soyElSolicitante && v.status === "autorizado";
  const hayQueMostrarGastos = v.gastos.length > 0 || puedeCapturar;

  // Los tickets solo hacen falta mientras se pueden capturar gastos.
  const tickets =
    soyElSolicitante && v.status === "autorizado"
      ? await ticketsDelContrato(v.contractId)
      : [];

  const loc = locale === "en" ? "en-US" : "es-MX";
  const fecha = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(loc, { dateStyle: "medium" });
  const cuando = (d: Date | null) =>
    d ? d.toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Cabecera ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{v.reference}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Plane className="size-5 text-primary" />
            {v.destination}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fecha(v.departsOn)} – {fecha(v.returnsOn)} ·{" "}
            <Link
              href={`/admin/contratos/${v.contractId}`}
              className="font-mono hover:underline"
            >
              {v.contractNumber}
            </Link>
            {v.solicitante ? ` · ${v.solicitante}` : ""}
          </p>
        </div>
        <Badge className="ring-1 ring-border">{ESTADO_LABELS[v.status]}</Badge>
      </div>

      {/*
        DE QUIÉN ES EL TURNO, ARRIBA DEL TODO.

        Esto estaba al final de la pantalla, debajo de la tabla de gastos, y en
        un borrador eso significaba al 99 % del alto: se creaba el viático, se
        pasaba de largo una tabla vacía y el botón de enviarlo no lo veía nadie.
        El documento se quedaba en borrador y quien tenía que autorizarlo no
        recibía nada — sin que ninguna de las dos partes supiera por qué.

        Lo que un expediente en curso tiene que contestar primero es «¿me toca a
        mí?». Por eso encabeza, con título, y no cierra la página como un
        apéndice.
      */}
      {!estaCerrado(v.status) ? (
        <Card className="border-primary/30 bg-primary/[0.03] p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary">
            {leToca ? "Te toca" : "En espera"}
          </p>
          <AccionesViatico
            id={v.id}
            estado={v.status}
            soyElSolicitante={soyElSolicitante}
            puedoFirmar={puedoFirmar}
            estimado={Number(v.estimatedMxn)}
            gastos={v.gastos.length}
          />
        </Card>
      ) : null}

      {/* ── Motivo y módulos ── */}
      <Card className="space-y-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Motivo</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{v.purpose}</p>
        </div>
        {v.modulos.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Módulos a atender
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {v.modulos.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  <Wrench className="size-3" />
                  {m.name}
                  <span className="text-muted-foreground">· {m.equipmentName}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* ── El dinero ── */}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Estimado
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {mxnViatico(Number(v.estimatedMxn))}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Autorizado
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {v.authorizedMxn ? mxnViatico(Number(v.authorizedMxn)) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Comprobado
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {mxnViatico(gastado)}
            </p>
          </div>
        </div>

        {/*
          EL CUADRE SOLO APARECE CUANDO HAY ANTICIPO.

          Antes de autorizar no hay contra qué cuadrar, y un saldo de «cero
          menos cero» se leería como que todo está en orden cuando en realidad
          todavía no ha empezado nada.
        */}
        {v.authorizedMxn ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {saldoEnPalabras(c)}
              </span>
              <span
                className={`text-xl font-semibold tabular-nums ${
                  c.excedido ? "text-destructive" : ""
                }`}
              >
                {mxnViatico(Math.abs(c.saldo))}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${c.excedido ? "bg-destructive" : "bg-success"}`}
                style={{ width: `${Math.min(100, c.consumido)}%` }}
              />
            </div>
            {c.excedido ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                Se gastó más de lo autorizado.
              </p>
            ) : null}
          </div>
        ) : null}

        {v.approvalNote || v.autorizadoPor ? (
          <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
            {v.approvalNote ? <p className="whitespace-pre-wrap">{v.approvalNote}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              Autorizado por {v.autorizadoPor ?? "—"} · {cuando(v.approvedAt) ?? "—"}
            </p>
          </div>
        ) : null}

        {/*
          El motivo de un rechazo, una devolución o una cancelación se enseña
          arriba del todo del expediente y no escondido al final: es la única
          información que dice qué hacer a continuación.
        */}
        {v.resolutionReason ? (
          <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2.5 text-sm">
            <p className="font-medium">Qué hay que corregir</p>
            <p className="mt-0.5 whitespace-pre-wrap">{v.resolutionReason}</p>
          </div>
        ) : null}

        {v.closingNote || v.cerradoPor ? (
          <div className="mt-3 rounded-lg bg-success/10 px-3 py-2.5 text-sm">
            {v.closingNote ? <p className="whitespace-pre-wrap">{v.closingNote}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              Cerrado por {v.cerradoPor ?? "—"} · {cuando(v.closedAt) ?? "—"}
            </p>
          </div>
        ) : null}
      </Card>

      {/*
        ── Gastos ──

        La tabla no aparece hasta que hay algo que enseñar o algo que capturar.
        En un borrador o en un viático recién enviado no puede haber gastos —el
        anticipo ni siquiera está autorizado—, así que una tabla vacía ahí solo
        empuja hacia abajo lo único accionable de la pantalla. Fue justamente lo
        que escondió el botón de enviar.
      */}
      {hayQueMostrarGastos ? (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileText className="size-4 text-primary" />
            Comprobación de gastos
          </h2>
          {sinComprobante > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5" />
              {sinComprobante} sin comprobante
            </span>
          ) : null}
        </div>

        {v.gastos.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay gastos cargados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Categoría</th>
                  <th className="px-4 py-2.5 font-medium">Descripción</th>
                  <th className="px-4 py-2.5 font-medium">Ticket</th>
                  <th className="px-4 py-2.5 font-medium">Comprobante</th>
                  <th data-num className="px-4 py-2.5 text-right font-medium">Importe</th>
                  {soyElSolicitante && v.status === "autorizado" ? (
                    <th className="w-8 px-2 py-2.5" />
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {v.gastos.map((g) => (
                  <tr key={g.id} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {fecha(g.spentOn)}
                    </td>
                    <td className="px-4 py-2.5">
                      {CATEGORIA_LABELS[g.category]}
                      {g.otherLabel ? (
                        <span className="text-muted-foreground"> · {g.otherLabel}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{g.description}</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/tickets/${g.ticketId}`}
                        className="font-mono text-xs text-primary hover:underline"
                        title={g.ticketSubject}
                      >
                        {g.ticketReference}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {g.receiptPath ? (
                        // Enlace y no visor embebido: un PDF incrustado por
                        // renglón es peso que se paga en cada carga para algo
                        // que se abre una vez.
                        <a
                          href={g.receiptPath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Ver
                        </a>
                      ) : (
                        <span className="text-xs text-warning">Sin comprobante</span>
                      )}
                    </td>
                    <td data-num className="px-4 py-2.5 text-right tabular-nums">
                      {mxnViatico(Number(g.amountMxn))}
                    </td>
                    {soyElSolicitante && v.status === "autorizado" ? (
                      <td data-num className="px-2 py-2.5 text-right">
                        <QuitarGasto gastoId={g.id} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr>
                  <td className="px-4 py-2.5 font-medium" colSpan={5}>
                    Total comprobado
                  </td>
                  <td data-num className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {mxnViatico(gastado)}
                  </td>
                  {soyElSolicitante && v.status === "autorizado" ? <td /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {soyElSolicitante && v.status === "autorizado" ? (
          <div className="border-t border-border bg-muted/20 p-5">
            <GastoForm viaticoId={v.id} tickets={tickets} />
          </div>
        ) : null}
      </Card>
      ) : null}
    </div>
  );
}
