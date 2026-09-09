import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { getViatico, listRubros } from "@/lib/data/viaticos";
import { membreteDeDocumento } from "@/lib/documentos";
import {
  CampoDoc,
  Documento,
  FirmasDoc,
  SeccionDoc,
} from "@/components/portal/documentos/documento";
import {
  ESTADO_LABELS,
  consumoPorRubro,
  cuadre,
  diasDeViaje,
  mxnViatico,
  saldoEnPalabras,
} from "@/lib/viaticos";

export const dynamic = "force-dynamic";

/**
 * LA COMPROBACIÓN DE VIÁTICOS, EN PAPEL.
 *
 * ── QUÉ DOCUMENTO ES ESTE ──────────────────────────────────────────────────
 *
 * El que se archiva y el que se firma. Un viático cerrado deja un movimiento de
 * dinero en las dos direcciones —un anticipo entregado y un saldo devuelto o
 * reembolsado— y eso acaba en una carpeta, delante de un contador o de un
 * auditor. Hasta ahora solo existía en la pantalla, así que la única forma de
 * archivarlo era una captura.
 *
 * ── LO QUE SÍ SALE Y LO QUE NO ─────────────────────────────────────────────
 *
 * Sale el cuadre completo: estimado, autorizado, comprobado y saldo, con el
 * detalle de cada gasto y quién firmó qué. Es un documento INTERNO —lo firman
 * quien viajó y quien autorizó—, así que aquí sí puede ir el dinero entero, a
 * diferencia del reporte de servicio, que va al cliente y nunca enseña costos.
 *
 * Sale también lo que se pasó del presupuesto. Un exceso escondido en el papel
 * es un exceso que nadie discute: si se firmó, se firmó sabiendo.
 *
 * ── NO REPITE EL MEMBRETE ──────────────────────────────────────────────────
 *
 * Ni el logo, ni la hoja, ni el pie, ni las clases de impresión: los pone
 * `<Documento>`. Esta página solo aporta su cuerpo, que es exactamente lo que
 * hace que los dos documentos de la empresa se vean iguales sin que nadie tenga
 * que acordarse de mantenerlos a la par.
 */
export default async function ReporteViaticoPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string; id: string }>;
}) {
  const { locale, tenant, id } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [session, administra] = await Promise.all([
    auth(),
    puedeEn("viaticos", "administrar"),
  ]);

  /*
    EL MISMO ACOTADO QUE LA FICHA, y no uno propio.

    `soloDe` hace que quien no administra solo alcance los suyos. Escribirlo otra
    vez —en vez de copiar la condición— es lo que impide que la versión
    imprimible se convierta en la puerta trasera del expediente de un compañero:
    la regla vive en `data/viaticos.ts` y las dos pantallas la piden igual.
  */
  const v = await getViatico(id, administra ? null : (session?.user?.id ?? null));
  if (!v) notFound();

  const [membrete, rubros] = await Promise.all([
    membreteDeDocumento(tenant),
    listRubros(false),
  ]);

  const loc = locale === "en" ? "en-US" : "es-MX";
  const fecha = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(loc, { dateStyle: "medium" });
  const dateOnly = (d: Date) => d.toLocaleDateString(loc, { dateStyle: "long" });

  const dias = diasDeViaje(v.departsOn, v.returnsOn);
  const gastado = v.gastos.reduce((a, g) => a + Number(g.amountMxn), 0);
  const c = cuadre(Number(v.authorizedMxn ?? 0), gastado);
  const consumo = consumoPorRubro(
    v.gastos.map((g) => ({ rubroId: g.rubroId, amountMxn: g.amountMxn })),
    rubros,
    dias,
  );
  const sinComprobante = v.gastos.filter((g) => !g.receiptPath).length;

  return (
    <Documento
      membrete={membrete}
      titulo="Comprobación de viáticos"
      folio={v.reference}
      volverA={`/admin/viaticos/${v.id}`}
      volverLabel="Volver al viático"
      emitido={dateOnly(new Date())}
    >
      {/* ── El viaje ── */}
      <section className="grid gap-8 py-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
            El viaje
          </h2>
          <CampoDoc k="Destino" v={v.destination} />
          <CampoDoc k="Salida" v={fecha(v.departsOn)} />
          <CampoDoc k="Regreso" v={fecha(v.returnsOn)} />
          <CampoDoc k="Días" v={dias} />
          <CampoDoc k="Estado" v={ESTADO_LABELS[v.status]} />
        </div>
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
            A cuenta de
          </h2>
          {/*
            El asunto es de uno de los dos tipos y nunca de los dos: lo garantiza
            el CHECK de la 0028. Se pinta el que tenga valor.
          */}
          {v.contractId ? (
            <CampoDoc k="Contrato" v={v.contractNumber} />
          ) : (
            <>
              <CampoDoc k="Prospecto" v={v.prospecto} />
              {v.negocio ? <CampoDoc k="Negocio" v={v.negocio} /> : null}
            </>
          )}
          <CampoDoc k="Solicitante" v={v.solicitante ?? "—"} />
          <CampoDoc k="Autoriza" v={v.aprobador ?? "—"} />
        </div>
      </section>

      <SeccionDoc className="py-2">
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
          Motivo
        </h2>
        <p className="whitespace-pre-wrap text-sm">{v.purpose}</p>
      </SeccionDoc>

      {/* ── El cuadre ── */}
      <SeccionDoc className="mt-4 rounded-lg bg-zinc-50 p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
          Cuadre
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Estimado</p>
            <p className="text-lg font-semibold tabular-nums">
              {mxnViatico(Number(v.estimatedMxn))}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Autorizado</p>
            <p className="text-lg font-semibold tabular-nums">
              {v.authorizedMxn ? mxnViatico(Number(v.authorizedMxn)) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Comprobado</p>
            <p className="text-lg font-semibold tabular-nums">{mxnViatico(gastado)}</p>
          </div>
        </div>

        {/*
          El saldo se dice EN PALABRAS y no solo con un signo: «−1 200» no le
          dice a nadie quién le debe a quién, y esa es la única pregunta que se
          le hace a un cuadre. Es la misma frase que usa la pantalla, desde
          `saldoEnPalabras`, para que el papel y el sistema no se contradigan.
        */}
        {v.authorizedMxn ? (
          <div className="mt-4 flex items-baseline justify-between border-t border-zinc-200 pt-3">
            <span className="text-sm text-zinc-500">{saldoEnPalabras(c)}</span>
            <span className="text-xl font-semibold tabular-nums">
              {mxnViatico(Math.abs(c.saldo))}
            </span>
          </div>
        ) : null}
      </SeccionDoc>

      {/* ── Presupuesto ── */}
      {consumo.some((x) => x.tope != null) ? (
        <SeccionDoc className="mt-4 rounded-lg border border-zinc-200 p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
            Contra el presupuesto
          </h2>
          {consumo
            .filter((x) => x.tope != null)
            .map((x) => (
              <CampoDoc
                key={x.rubroId}
                k={x.nombre}
                v={
                  <span className={x.excedido ? "text-red-700" : ""}>
                    {mxnViatico(x.gastado)} de {mxnViatico(x.tope!)}
                    {x.excedido ? ` · se pasó ${mxnViatico(x.exceso)}` : ""}
                  </span>
                }
              />
            ))}
        </SeccionDoc>
      ) : null}

      {/* ── Los gastos ── */}
      <SeccionDoc className="py-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
          Gastos comprobados
        </h2>
        {v.gastos.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">
            Todavía no hay gastos cargados.
          </p>
        ) : (
                      <table
            /*
              `tabla-erp` también en el papel, y no un estilo propio del
              documento. Es la clase compartida que exige `probe-tablas.mts`, y
              exigirla es justo lo que pedía la homogeneidad: una segunda
              tipografía de tabla «para documentos» sería la que se queda sin el
              arreglo que reciba la primera.
            */
            className="tabla-erp w-full text-sm"
          >
            <thead className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="py-2 font-medium">Fecha</th>
                <th className="py-2 font-medium">Rubro</th>
                <th className="py-2 font-medium">Descripción</th>
                <th className="py-2 font-medium">Se carga a</th>
                <th data-num className="py-2 text-right font-medium">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {v.gastos.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap py-2 text-zinc-500">
                    {fecha(g.spentOn)}
                  </td>
                  <td className="py-2">
                    {g.rubro}
                    {g.note ? <span className="text-zinc-500"> · {g.note}</span> : null}
                  </td>
                  <td className="py-2">
                    {g.description}
                    {/*
                      El «sin comprobante» va PEGADO al renglón y no solo en el
                      total: quien revisa el papel necesita saber cuál es, no
                      cuántos son.
                    */}
                    {!g.receiptPath ? (
                      <span className="block text-xs text-amber-700">
                        sin comprobante
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-zinc-500">
                    {g.ticketReference ?? g.dealTitle ?? "Gasto comercial"}
                  </td>
                  <td data-num className="py-2 text-right tabular-nums">
                    {mxnViatico(Number(g.amountMxn))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-zinc-300">
              <tr>
                <td className="py-2 font-medium" colSpan={4}>
                  Total comprobado
                </td>
                <td data-num className="py-2 text-right font-semibold tabular-nums">
                  {mxnViatico(gastado)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {sinComprobante > 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="size-3.5" />
            {sinComprobante} gasto(s) sin comprobante adjunto.
          </p>
        ) : null}
      </SeccionDoc>

      {/* ── Notas de las firmas ── */}
      {v.approvalNote || v.closingNote || v.resolutionReason ? (
        <SeccionDoc className="rounded-lg border border-zinc-200 p-5 text-sm">
          {v.approvalNote ? (
            <p>
              <span className="text-zinc-500">Al autorizar: </span>
              {v.approvalNote}
            </p>
          ) : null}
          {v.resolutionReason ? (
            <p className="mt-1">
              <span className="text-zinc-500">Motivo: </span>
              {v.resolutionReason}
            </p>
          ) : null}
          {v.closingNote ? (
            <p className="mt-1">
              <span className="text-zinc-500">Al cerrar: </span>
              {v.closingNote}
            </p>
          ) : null}
        </SeccionDoc>
      ) : null}

      {/*
        QUIEN PIDE NO FIRMA LAS DOS. Las rúbricas son las dos personas que la
        base guarda por separado desde la 0026 —quien viajó y quien firmó—, y no
        una sola casilla de «revisado»: son dos decisiones con semanas de por
        medio, y el papel tiene que poder responder meses después quién dejó
        pasar una comprobación floja.
      */}
      <FirmasDoc
        firmas={[
          { nombre: v.solicitante, calidad: "Quien viajó y comprueba" },
          {
            nombre: v.cerradoPor ?? v.autorizadoPor ?? v.aprobador,
            calidad: "Autoriza y da el visto bueno",
          },
        ]}
      />
    </Documento>
  );
}
