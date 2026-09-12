import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AlertTriangle, FileText, Plane, Printer, Wrench } from "lucide-react";
import { auth } from "@/lib/auth";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import {
  getViatico,
  listRubros,
  opcionesDeGasto,
} from "@/lib/data/viaticos";
import { aprobadoresPosibles } from "@/lib/domain/viaticos";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AccionesViatico,
  QuitarGasto,
  ReasignarViatico,
  ReclasificarGasto,
} from "@/components/portal/viaticos/acciones";
import { GastoForm } from "@/components/portal/viaticos/gasto-form";
import {
  DESTINO_LABELS,
  ESTADO_LABELS,
  consumoPorRubro,
  cuadre,
  diasDeViaje,
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
    PUEDO FIRMAR = puedo administrar, no soy quien lo pidió, Y ME LO MANDARON.

    Las dos últimas mitades son las que importan y las que se olvidan:

      · el administrador que además viaja tiene permiso de módulo sobre sus
        propios viáticos;
      · desde la 0028 el documento va a nombre de una persona, y quien
        administra puede verlos todos sin que le toque firmar los de los demás.

    Las tres condiciones son EXACTAMENTE las de `firmaValida()` en
    `domain/viaticos.ts`, que es quien decide de verdad; aquí se repiten para que
    el botón ni siquiera aparezca. Que la pantalla y el guardia digan lo mismo
    es lo que evita ofrecer una puerta que luego se cierra — y sin la tercera,
    a cinco personas les habría salido un «Autorizar» que responde «está a
    nombre de otra persona».

    Aprobador nulo sigue significando «cualquiera que administre»: son las filas
    anteriores a la 0028.
  */
  const puedoFirmar =
    administra &&
    !soyElSolicitante &&
    (v.approverId === null || v.approverId === yo);

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

  /*
    EL PRESUPUESTO POR RUBRO, y quién se pasó.

    Los rubros se piden siempre —no solo al capturar— porque quien REVISA
    necesita ver lo mismo que vio quien capturó: el tope contra el que se
    compara cada renglón. Son unas pocas filas.
  */
  const rubros = await listRubros(false);
  const dias = diasDeViaje(v.departsOn, v.returnsOn);
  const consumo = consumoPorRubro(
    v.gastos.map((g) => ({ rubroId: g.rubroId, amountMxn: g.amountMxn })),
    rubros,
    dias,
  );
  const excedidos = consumo.filter((c) => c.excedido);

  const gastado = v.gastos.reduce((a, g) => a + Number(g.amountMxn), 0);
  const c = cuadre(Number(v.authorizedMxn ?? 0), gastado);
  const sinComprobante = v.gastos.filter((g) => !g.receiptPath).length;
  const puedeCapturar = soyElSolicitante && v.status === "autorizado";
  const hayQueMostrarGastos = v.gastos.length > 0 || puedeCapturar;

  /*
    ¿Tiene sentido reasignar? Solo mientras alguien tenga que firmar algo: en
    borrador todavía no se ha mandado a nadie, y cerrado ya no hay nada que
    mover. Los mismos tres estados que admite el dominio.
  */
  const puedeReasignarse =
    v.status === "enviado" || v.status === "autorizado" || v.status === "en_revision";
  // Sin el solicitante: no se firma lo que uno pide, tampoco tras una
  // reasignación.
  const aprobadores =
    administra && puedeReasignarse ? await aprobadoresPosibles(v.requestedById) : [];

  const capturando = soyElSolicitante && v.status === "autorizado";
  /*
    A QUÉ SE PUEDE CARGAR UN GASTO, y solo cuando alguien va a elegir: quien
    captura, o quien firma mientras revisa. Es LA MISMA lista para los dos
    —`opcionesDeGasto`—: el desplegable de quien reclasifica tiene que traer
    las mismas opciones que tuvo quien capturó.
  */
  const opciones =
    capturando || (puedoFirmar && v.status === "en_revision")
      ? await opcionesDeGasto(v.destinos)
      : [];
  /*
    ¿Se pueden mover los renglones de sitio? Solo quien firma, solo en revisión,
    y solo si hay más de un sitio: un desplegable de una sola opción es ofrecer
    una decisión que no existe.
  */
  const reclasificando = puedoFirmar && v.status === "en_revision" && opciones.length > 1;
  /** Nombre del destino de un gasto, para la columna «Se carga a». */
  const nombreDestino = new Map(
    v.destinos.map((d) => [d.id, d.tipo === "contrato" ? `Contrato ${d.contractNumber ?? "—"}` : (d.organizacion ?? "—")]),
  );

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
            {fecha(v.departsOn)} – {fecha(v.returnsOn)}
            {v.solicitante ? ` · ${v.solicitante}` : ""}
          </p>
          {/*
            LOS DESTINOS, uno por renglón y en orden de visita (0037).

            Cada uno lleva a su expediente: el contrato al contrato, la visita y
            el prospecto a la ficha de la empresa, y el negocio —cuando el viaje
            va por una oportunidad concreta— a la oportunidad. Enseñar «—» donde
            falta el contrato habría sido lo cómodo y lo que esconde el modelo.
          */}
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {v.destinos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {DESTINO_LABELS[d.tipo]}
                </span>
                {d.tipo === "contrato" ? (
                  <Link href={`/admin/contratos/${d.contractId}`} className="font-mono hover:underline">
                    {d.contractNumber}
                  </Link>
                ) : (
                  <Link href={`/admin/organizaciones/${d.organizationId}`} className="hover:underline">
                    {d.organizacion}
                  </Link>
                )}
                {d.dealId ? (
                  <>
                    · por el negocio
                    <Link href={`/admin/crm/negocios/${d.dealId}`} className="text-primary hover:underline">
                      {d.negocio}
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2">
          {/*
            IMPRIMIR ESTÁ EN LA CABECERA, no al final del expediente.

            Es lo mismo que se aprendió con el bloque de acciones: enterrado bajo
            la tabla de gastos, en un viático largo queda a un scroll entero de
            distancia y nadie lo encuentra. Y aquí el documento se busca justo
            cuando hay que archivarlo, que es al terminar de mirarlo.
          */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/viaticos/${v.id}/reporte`}>
              <Printer className="size-4" /> Imprimir
            </Link>
          </Button>
          <Badge className="ring-1 ring-border">{ESTADO_LABELS[v.status]}</Badge>
        </div>
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
          {/*
            A NOMBRE DE QUIÉN ESTÁ, dicho antes que los botones.

            Un viático que espera firma y no dice de quién la espera es el
            documento que se queda parado dos semanas mientras cada uno supone
            que lo mirará otro. Es exactamente lo que la 0028 vino a arreglar,
            así que la respuesta va donde se hace la pregunta.

            No aparece en los que no tienen aprobador —los anteriores a la
            0028—: ahí la respuesta sigue siendo «cualquiera que administre», y
            escribirlo en cada uno sería ruido.
          */}
          {v.approverId && !estaCerrado(v.status) ? (
            <p className="mb-3 text-sm text-muted-foreground">
              A firma de{" "}
              <span className="font-medium text-foreground">
                {v.aprobador ?? "—"}
              </span>
              {v.approverId === yo ? " · eres tú" : ""}
            </p>
          ) : null}

          <AccionesViatico
            id={v.id}
            estado={v.status}
            soyElSolicitante={soyElSolicitante}
            puedoFirmar={puedoFirmar}
            estimado={Number(v.estimatedMxn)}
            gastos={v.gastos.length}
          />

          {/*
            REASIGNAR: la salida cuando quien tiene que firmar no está.

            Solo para quien administra, y no solo para el aprobador actual —el
            caso que esto resuelve es justamente que el aprobador actual está de
            vacaciones—. Va debajo de las acciones y no entre ellas porque no es
            una decisión sobre el viaje: es una decisión sobre quién lo mira.
          */}
          {administra && puedeReasignarse ? (
            <ReasignarViatico
              id={v.id}
              actual={v.approverId}
              aprobadores={aprobadores}
            />
          ) : null}
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
          <div className="flex flex-wrap items-center gap-3">
            {/*
              LO QUE SE PASÓ DEL PRESUPUESTO, junto a lo que va sin comprobante.

              Los dos contestan la misma pregunta de quien revisa —«¿hay algo
              aquí que mirar con lupa?»— y por eso van en el mismo renglón, no
              repartidos por la pantalla.

              Se marca el RUBRO y no el gasto: el tope es del rubro en todo el
              viaje, así que señalar un renglón suelto diría algo que no es.
            */}
            {excedidos.length > 0 ? (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                {excedidos.map((c) => `${c.nombre} +${mxnViatico(c.exceso)}`).join(" · ")}
              </span>
            ) : null}
            {sinComprobante > 0 ? (
              <span className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5" />
                {sinComprobante} sin comprobante
              </span>
            ) : null}
          </div>
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
                  <th className="px-4 py-2.5 font-medium">Rubro</th>
                  <th className="px-4 py-2.5 font-medium">Descripción</th>
                  {/*
                    «Se carga a» y no «Ticket»: desde la 0028 la columna
                    contesta una pregunta más amplia —a qué se le imputa este
                    gasto— y las tres respuestas posibles son un ticket, un
                    negocio o nada. Dejarla titulada «Ticket» habría hecho leer
                    los renglones comerciales como tickets que faltan.
                  */}
                  <th className="px-4 py-2.5 font-medium">Se carga a</th>
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
                      {g.rubro}
                      {g.note ? (
                        <span className="text-muted-foreground"> · {g.note}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{g.description}</td>
                    <td className="px-4 py-2.5">
                      {g.ticketId ? (
                        <Link
                          href={`/tickets/${g.ticketId}`}
                          className="font-mono text-xs text-primary hover:underline"
                          title={g.ticketSubject ?? undefined}
                        >
                          {g.ticketReference}
                        </Link>
                      ) : g.dealId ? (
                        <Link
                          href={`/admin/crm/negocios/${g.dealId}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {g.dealTitle}
                        </Link>
                      ) : (
                        /*
                          Con todas sus letras, y no un guion: el destino a
                          secas o el gasto general del viaje. El guion se lee
                          como dato que falta, y esto es un destino elegido: la
                          diferencia importa justo cuando quien revisa decide si
                          moverlo.
                        */
                        <span className="text-xs text-muted-foreground">
                          {g.destinoId
                            ? (nombreDestino.get(g.destinoId) ?? "Gasto comercial")
                            : "Gasto general del viaje"}
                        </span>
                      )}
                      {g.reclassifiedAt ? (
                        <span
                          className="ml-1.5 text-xs text-muted-foreground"
                          title="Lo movió quien revisó la comprobación"
                        >
                          (reclasificado)
                        </span>
                      ) : null}
                      {reclasificando ? (
                        <ReclasificarGasto
                          gastoId={g.id}
                          opciones={opciones}
                          actual={
                            g.ticketId
                              ? `ticket:${g.ticketId}`
                              : g.dealId
                                ? `negocio:${g.dealId}`
                                : g.destinoId
                                  ? `destino:${g.destinoId}`
                                  : "general"
                          }
                        />
                      ) : null}
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
            <GastoForm
              viaticoId={v.id}
              opciones={opciones}
              // Solo los ACTIVOS al capturar: los retirados siguen arriba, en
              // la tabla, sosteniendo el nombre de lo ya capturado.
              rubros={rubros.filter((r) => r.active)}
              dias={dias}
            />
          </div>
        ) : null}
      </Card>
      ) : null}
    </div>
  );
}
