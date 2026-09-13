import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { membreteDeDocumento } from "@/lib/documentos";
import {
  Documento,
  FirmasDoc,
} from "@/components/portal/documentos/documento";
import { ROLE_LABELS } from "@/lib/roles";
import { getTicketById } from "@/lib/data/tickets";
import { rolesByUser } from "@/lib/data/people";
import { puedeEn } from "@/lib/tenancy/context";
import { CATEGORY_LABELS, STATUS_LABELS, PRIORITY_LABELS, label } from "@/lib/tickets";

export default async function TicketReportPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string; id: string }>;
}) {
  const { locale, tenant, id } = await params;
  setRequestLocale(locale);

  // Reporte generado por el equipo de servicio (agente/admin).
  if (!(await puedeEn("servicio", "ver"))) notFound();

  const ticket = await getTicketById(id);
  if (!ticket) notFound();

  /*
    EL MEMBRETE DE ESTA EMPRESA. Sale de la misma fila cacheada que usa el
    layout, así que pintar el reporte no cuesta una consulta más.

    La cascada del logo es documento → marca → monograma, y está escrita en un
    solo sitio a propósito: el formulario de Configuración la reproduce para su
    vista previa, y si alguna vez dejaran de coincidir, la vista previa estaría
    mintiendo sobre lo único que promete.
  */
  /*
    El membrete sale de la capa de documentos, no de aquí.

    Estaba escrito en esta página —la cascada del logo y el armado del pie—, y
    en cuanto apareció el segundo documento imprimible eso habría sido una
    copia. Ver `lib/documentos.ts`.
  */
  const membrete = await membreteDeDocumento(tenant);

  const loc = locale === "en" ? "en-US" : "es-MX";
  const dt = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" }) : "—";
  const dateOnly = (d: Date | string | null) =>
    d ? new Date(d).toLocaleDateString(loc, { dateStyle: "long" }) : "—";

  // Bitácora visible al cliente (sin notas internas).
  const log = ticket.comments.filter((c) => !c.internal);
  const authorRoles = await rolesByUser(log.map((c) => c.author.id));

  // Tiempos y cumplimiento del SLA de primera respuesta del ticket.
  const created = new Date(ticket.createdAt);
  const firstResp = ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt) : null;
  const resolved = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;
  const slaDue = ticket.slaDueAt ? new Date(ticket.slaDueAt) : null;
  const slaMet = firstResp && slaDue ? firstResp <= slaDue : null;
  const horasObjetivo =
    slaDue && ticket.createdAt
      ? Math.round((slaDue.getTime() - new Date(ticket.createdAt).getTime()) / 3_600_000)
      : null;

  // Horas de servicio acumuladas en la bitácora (para facturación).
  const totalHours = log.reduce((a, c) => a + Number(c.hours ?? 0), 0);

  // Refacciones consumidas y su importe.
  const allParts = log.flatMap((c) => c.parts);
  const partsTotal = allParts.reduce(
    (a, p) => a + Number(p.unitCostMxn ?? 0) * p.quantity,
    0,
  );
  const mxn = (n: number) =>
    new Intl.NumberFormat(loc, {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(n);

  const durationText = (() => {
    if (!resolved) return "En proceso";
    const ms = resolved.getTime() - created.getTime();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return `${h} h ${m} min`;
  })();

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b border-zinc-200 py-1.5">
      <span className="text-zinc-500">{k}</span>
      <span className="text-right font-medium text-zinc-900">{v}</span>
    </div>
  );

  return (
    <Documento
      membrete={membrete}
      titulo="Reporte de servicio"
      folio={ticket.reference}
      volverA={`/tickets/${ticket.id}`}
      volverLabel="Volver al ticket"
      emitido={dateOnly(new Date())}
    >

        {/* Datos principales */}
        <section className="grid gap-8 py-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Laboratorio / Cliente
            </h2>
            <div className="text-sm">
              <Row k="Empresa" v={ticket.createdBy.company ?? "—"} />
              <Row k="Contacto" v={ticket.createdBy.name ?? "—"} />
              <Row k="Correo" v={ticket.createdBy.email} />
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Datos del servicio
            </h2>
            <div className="text-sm">
              <Row k="Categoría" v={label(CATEGORY_LABELS, ticket.category, locale)} />
              <Row k="Prioridad" v={label(PRIORITY_LABELS, ticket.priority, locale)} />
              <Row k="Estado" v={label(STATUS_LABELS, ticket.status, locale)} />
              <Row
                k="Técnico asignado"
                v={ticket.assignedTo?.name ?? ticket.assignedTo?.email ?? "Sin asignar"}
              />
            </div>
          </div>
        </section>

        {/* Equipo atendido */}
        {ticket.equipment && (
          <section className="print-avoid-break rounded-lg border border-zinc-200 p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Equipo atendido
            </h2>
            <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              <Row k="Marca" v={ticket.equipment.brand} />
              <Row k="Equipo" v={ticket.equipment.name} />
              <Row k="Modelo" v={ticket.equipment.model ?? "—"} />
              {ticket.module ? (
                <>
                  <Row k="Módulo intervenido" v={ticket.module.name} />
                  <Row k="Marca del módulo" v={ticket.module.brand} />
                  <Row
                    k="N° de serie"
                    v={
                      <span className="font-mono">
                        {ticket.module.serialNumber ?? "—"}
                      </span>
                    }
                  />
                </>
              ) : (
                <Row k="Alcance" v="Equipo completo" />
              )}
            </div>
          </section>
        )}

        {/* Requerimiento */}
        <section className="print-avoid-break py-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
            Descripción del requerimiento
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {ticket.description}
          </p>
        </section>

        {/* Bitácora */}
        <section className="py-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
            Bitácora de trabajo
          </h2>
          {log.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin registros de trabajo.</p>
          ) : (
            <ol className="space-y-3">
              {log.map((c) => (
                <li
                  key={c.id}
                  className="print-avoid-break border-l-2 border-zinc-300 pl-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-semibold text-zinc-900">
                      {c.author.name ?? c.author.email}
                      {authorRoles.get(c.author.id) && (
                        <span className="ml-2 font-normal text-zinc-400">
                          {ROLE_LABELS[authorRoles.get(c.author.id)!]}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {c.hours && (
                        <span className="font-semibold text-zinc-900">
                          {Number(c.hours)} h
                        </span>
                      )}
                      <span className="font-mono text-zinc-500">{dt(c.createdAt)}</span>
                    </span>
                  </div>
                  {/* Componente sobre el que se realizó la actividad */}
                  {c.equipment && (
                    <p className="mt-1 text-[12px] text-zinc-600">
                      <span className="font-semibold">Componente:</span>{" "}
                      {c.equipment.brand} {c.equipment.name}
                      {c.equipment.model ? ` (${c.equipment.model})` : ""}
                      {c.module && (
                        <>
                          {" › "}
                          {c.module.name}
                          {c.module.serialNumber && (
                            <span className="font-mono"> S/N {c.module.serialNumber}</span>
                          )}
                        </>
                      )}
                      {c.submodule && (
                        <>
                          {" › "}
                          {c.submodule.name}
                          {c.submodule.serialNumber && (
                            <span className="font-mono"> S/N {c.submodule.serialNumber}</span>
                          )}
                        </>
                      )}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {c.body}
                  </p>
                  {/* Refacciones utilizadas en esta actividad */}
                  {c.parts.length > 0 && (
                    // La hoja de servicio se IMPRIME: no lleva contenedor con
                    // desplazamiento, que en papel no significa nada.
                    <div>
                      <table className="tabla-erp mt-2 w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-zinc-200 text-left text-zinc-500">
                            <th className="py-1 font-medium"># Parte</th>
                            <th className="py-1 font-medium">Descripción</th>
                            <th className="py-1 text-center font-medium">Cant.</th>
                            <th data-num className="py-1 text-right font-medium">Costo unit.</th>
                            <th data-num className="py-1 text-right font-medium">Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.parts.map((p) => (
                            <tr key={p.id} className="border-b border-zinc-100">
                              <td className="py-1 font-mono">{p.partNumber}</td>
                              <td className="py-1">{p.description}</td>
                              <td className="py-1 text-center">{p.quantity}</td>
                              <td data-num className="py-1 text-right">
                                {p.unitCostMxn ? mxn(Number(p.unitCostMxn)) : "—"}
                              </td>
                              <td data-num className="py-1 text-right font-medium">
                                {p.unitCostMxn
                                  ? mxn(Number(p.unitCostMxn) * p.quantity)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Tiempos y SLA */}
        <section className="print-avoid-break rounded-lg bg-zinc-50 p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
            Tiempos y nivel de servicio (SLA)
          </h2>
          <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row k="Creado" v={dt(created)} />
            <Row k="Primera respuesta" v={dt(firstResp)} />
            <Row k="Resuelto" v={dt(resolved)} />
            <Row k="Duración total" v={durationText} />
            <Row
              k="Horas de servicio"
              v={
                totalHours > 0 ? (
                  <span className="font-semibold">{totalHours.toFixed(2)} h</span>
                ) : (
                  "—"
                )
              }
            />
            {/*
              El plazo de ESTE ticket, no «< 2 h»: el que se congeló al crearlo
              —el pactado con el cliente o el general de la empresa, que desde
              la 0038 decide cada una—. El texto fijo mentía en cuanto alguien
              pactaba otro plazo.
            */}
            <Row
              k={`Objetivo SLA${horasObjetivo ? ` (< ${horasObjetivo} h)` : ""}`}
              v={dt(slaDue)}
            />
            <Row
              k="Cumplimiento SLA"
              v={
                slaMet === null ? (
                  <span className="text-zinc-500">Pendiente</span>
                ) : slaMet ? (
                  <span className="font-semibold text-green-700">✓ Cumplido</span>
                ) : (
                  <span className="font-semibold text-red-700">✗ No cumplido</span>
                )
              }
            />
          </div>
        </section>

        {/* Resumen de refacciones */}
        {allParts.length > 0 && (
          <section className="print-avoid-break mt-4 rounded-lg border border-zinc-200 p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Resumen de refacciones utilizadas
            </h2>
            {/* Se desplaza DENTRO de su caja: una tabla ancha nunca empuja la página. */}
            <div className="tabla-caja">
              <table className="tabla-erp w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-left text-zinc-500">
                    <th className="py-1.5 font-medium"># Parte</th>
                    <th className="py-1.5 font-medium">Descripción</th>
                    <th className="py-1.5 text-center font-medium">Cant.</th>
                    <th data-num className="py-1.5 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {allParts.map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100">
                      <td className="py-1.5 font-mono text-[13px]">{p.partNumber}</td>
                      <td className="py-1.5">{p.description}</td>
                      <td className="py-1.5 text-center">{p.quantity}</td>
                      <td data-num className="py-1.5 text-right">
                        {p.unitCostMxn ? mxn(Number(p.unitCostMxn) * p.quantity) : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-semibold">
                      Total refacciones
                    </td>
                    <td data-num className="py-2 text-right font-bold">{mxn(partsTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        <FirmasDoc
          firmas={[
            {
              nombre: ticket.assignedTo?.name ?? `Técnico de ${membrete.nombre}`,
              calidad: "Técnico de servicio",
            },
            {
              nombre: ticket.createdBy.name ?? "Cliente",
              calidad: "Conformidad del cliente",
            },
          ]}
        />
    </Documento>
  );
}
