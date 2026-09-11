import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isAdminRole, isSupport } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";
import { getRequisition } from "@/lib/data/requisitions";
import { getSuppliers } from "@/lib/data/purchasing";
import { RequisitionStatusBadge } from "@/components/portal/purchasing/requisition-badge";
import { PurchaseStatusBadge } from "@/components/portal/purchasing/status-badge";
import { RequisitionActions } from "@/components/portal/purchasing/requisition-actions";
import { RequisitionLines } from "@/components/portal/purchasing/requisition-lines";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import type { PurchaseOrderStatus, RequisitionStatus } from "@/lib/db/schema";

export default async function RequisicionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const role = await currentRole();
  if (!isSupport(role)) {
    await redirectInTenant("/dashboard", locale);
  }

  const req = await getRequisition(id);
  if (!req) notFound();

  const editable = req.status === "draft";
  const puedeAutorizar = isAdminRole(role);

  // Los proveedores solo se cargan si se van a usar: en una requisición ya
  // autorizada la tabla es de lectura. Las refacciones no se cargan nunca —el
  // renglón las busca al teclear—: eran el catálogo entero, 6 609 desde la
  // carga del ERP anterior, en cada visita a un borrador.
  const suppliers = editable ? await getSuppliers(true, true) : [];

  const pendientes = req.lines.filter(
    (l) => l.quantity > l.orderedQuantity && l.partId && l.supplierId,
  ).length;
  const atoradas = req.lines.filter(
    (l) => l.quantity > l.orderedQuantity && (!l.partId || !l.supplierId),
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras/requisiciones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Requisiciones
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold">{req.reference}</h1>
            <RequisitionStatusBadge status={req.status as RequisitionStatus} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{req.title}</p>
          {req.dealId && req.dealReference && (
            <p className="mt-1 text-sm">
              Para el pedido{" "}
              <Link
                href={`/admin/crm/negocios/${req.dealId}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {req.dealReference}
              </Link>
            </p>
          )}
        </div>

        <RequisitionActions
          id={req.id}
          status={req.status as RequisitionStatus}
          puedeAutorizar={puedeAutorizar}
          pendientes={pendientes}
        />
      </div>

      {/* El expediente: quién pidió, quién autorizó y para cuándo. Es la razón
          de ser del documento, así que va arriba y no escondido al final. */}
      <Card className="grid gap-4 p-5 sm:grid-cols-4">
        <Dato titulo="Pidió" valor={req.pedidoPor ?? "—"} />
        <Dato
          titulo="Autorizó"
          valor={
            req.approvedAt
              ? `${req.autorizoPor ?? "—"} · ${fecha(req.approvedAt)}`
              : "Sin autorizar"
          }
        />
        <Dato titulo="Se necesita" valor={req.neededBy ?? "Sin fecha"} />
        <Dato titulo="Levantada" valor={fecha(req.createdAt)} />
        {req.notes && (
          <div className="sm:col-span-4">
            <Dato titulo="Notas" valor={req.notes} />
          </div>
        )}
        {req.resolutionReason && (
          <div className="sm:col-span-4">
            <Dato
              titulo={req.status === "rejected" ? "Motivo del rechazo" : "Motivo de la baja"}
              valor={req.resolutionReason}
            />
          </div>
        )}
      </Card>

      {/* Un renglón atorado no rompe nada y por eso hay que decirlo en voz alta:
          la requisición se queda para siempre en «parcial» sin que nadie sepa
          por qué, y el pedido del cliente se surte incompleto. */}
      {atoradas > 0 && (
        <Card className="border-warning/30 bg-warning/5 p-4">
          <p className="text-sm">
            <span className="font-medium text-warning">
              {atoradas} {atoradas === 1 ? "renglón" : "renglones"} sin poder comprarse
            </span>{" "}
            — les falta refacción del catálogo o proveedor.
            {editable
              ? " Resuélvelos abajo antes de mandarla a autorizar."
              : " No van a convertirse en orden hasta que se resuelvan."}
          </p>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <RequisitionLines
          lines={req.lines}
          editable={editable}
          suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
        />
      </Card>

      {/* La otra mitad de la trazabilidad: de la requisición a las órdenes.
          Sin esto solo se puede ir en un sentido, y la pregunta que se hace
          siempre es «¿ya se pidió?». */}
      {req.orders.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Órdenes generadas
          </h2>
          <Card className="overflow-hidden p-0">
            {/* Se desplaza DENTRO de su caja: una tabla ancha nunca empuja la página. */}
            <div className="tabla-caja">
              <table className="tabla-erp w-full text-sm">
                <tbody className="divide-y divide-border">
                  {req.orders.map((o) => (
                    <tr key={o.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/compras/${o.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {o.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{o.supplier}</td>
                      <td className="px-4 py-3">
                        <PurchaseStatusBadge
                          status={o.status as PurchaseOrderStatus}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {o.expectedAt ? `Se espera ${o.expectedAt}` : "Sin fecha"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <p className="mt-0.5 text-sm">{valor}</p>
    </div>
  );
}

function fecha(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}
