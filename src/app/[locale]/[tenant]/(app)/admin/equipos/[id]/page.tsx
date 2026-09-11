import { setRequestLocale } from "next-intl/server";
import { isSupport, isSalesRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { notFound } from "next/navigation";
import { Boxes, Cpu, FileSignature, HardDrive, Wrench } from "lucide-react";
import { getContractsForClient } from "@/lib/data/contracts";
import {
  getOwner,
  getEquipmentTree,
  getTicketsByEquipment,
} from "@/lib/data/equipment";
import { StatusBadge } from "@/components/portal/badges";
import type { TicketStatusValue } from "@/lib/tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";
import {
  AddEquipmentForm,
  AddModuleForm,
  AddSubmoduleForm,
  DeleteButton,
} from "@/components/portal/equipment-forms";

// Miniatura de foto (usa <img> porque las imágenes se suben en runtime).
function Thumb({
  src,
  size = "size-12",
  fallback,
}: {
  src: string | null;
  size?: string;
  fallback: React.ReactNode;
}) {
  if (!src) {
    return (
      <div
        className={`flex ${size} items-center justify-center rounded-md border border-dashed border-border text-muted-foreground`}
      >
        {fallback}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${size} rounded-md border border-border object-cover`}
    />
  );
}

export default async function LabEquipmentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;

  // Guard propio: el inventario de equipos de un cliente es dato de SERVICIO
  // —lo consulta un agente antes de ir a sitio y un vendedor desde el contrato
  // que los ampara—, así que vive fuera de Configuración y admite a todo el
  // personal de soporte, no solo al administrador.
  // Una sola vez: estaba pedido dos veces en la misma condición. Está memoizado
  // por petición, así que no costaba una consulta de más — pero leer dos veces
  // lo mismo en una línea invita a que un día sean dos valores distintos.
  const role = await currentRole();
  if (!isSupport(role) && !isSalesRole(role)) {
    await redirectInTenant("/dashboard", locale);
  }
  setRequestLocale(locale);

  // Las tres dependen solo del cliente, no una de otra: iban en cascada y son
  // una tanda.
  const [owner, tree, contracts] = await Promise.all([
    getOwner(id),
    getEquipmentTree(id),
    getContractsForClient(id),
  ]);
  if (!owner) notFound();

  // Historial de tickets por equipo (servicios previos).
  const historyByEquipment = new Map(
    await Promise.all(
      tree.map(
        async (eq) =>
          [eq.id, await getTicketsByEquipment(eq.id)] as const,
      ),
    ),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipos del laboratorio</h1>
          <p className="text-sm text-muted-foreground">
            {owner.company ?? owner.name ?? owner.email}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          {/* Los equipos son de un laboratorio: se vuelve a los clientes. */}
          <Link href="/admin/configuracion/usuarios?grupo=clientes">← Usuarios</Link>
        </Button>
      </div>

      {/* Contratos del laboratorio */}
      {contracts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileSignature className="size-4 text-primary" /> Contratos
          </h2>
          <ul className="space-y-2">
            {contracts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
              >
                <span className="font-mono font-medium text-primary">{c.number}</span>
                <span className="text-muted-foreground">
                  Vendedor: {c.salesRep?.name ?? c.salesRep?.email ?? "—"}
                </span>
                <span className="text-muted-foreground">
                  {c.equipmentLinks.length} equipo(s) amparado(s)
                </span>
                {c.amountMxn && (
                  <span className="ml-auto font-medium">
                    {new Intl.NumberFormat("es-MX", {
                      style: "currency",
                      currency: "MXN",
                      maximumFractionDigits: 0,
                    }).format(Number(c.amountMxn))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddEquipmentForm ownerId={id} />

      {tree.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Boxes className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay equipos registrados. Agrega el primer equipo y luego sus
            módulos y submódulos.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {tree.map((eq) => (
            <Card key={eq.id} className="overflow-hidden">
              {/* Equipo */}
              <div className="flex items-start gap-4 border-b border-border bg-secondary/30 p-5">
                <Thumb src={eq.photo} size="size-16" fallback={<Boxes className="size-6" />} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary/10 text-primary ring-primary/20">{eq.brand}</Badge>
                    <h2 className="truncate text-lg font-semibold">{eq.name}</h2>
                  </div>
                  {eq.model && (
                    <p className="text-sm text-muted-foreground">Modelo: {eq.model}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {eq.modules.length} módulo(s)
                  </p>
                </div>
                <DeleteButton kind="equipment" id={eq.id} ownerId={id} label={`equipo ${eq.name}`} />
              </div>

              {/* Módulos */}
              <div className="space-y-4 p-5">
                {eq.modules.map((mod) => (
                  <div key={mod.id} className="rounded-xl border border-border">
                    <div className="flex items-start gap-3 p-4">
                      <Thumb src={mod.photo} fallback={<Cpu className="size-5" />} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="bg-signal/15 text-signal-bright ring-signal/25">{mod.brand}</Badge>
                          <span className="font-medium">{mod.name}</span>
                        </div>
                        {mod.serialNumber && (
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            S/N: {mod.serialNumber}
                          </p>
                        )}
                      </div>
                      <DeleteButton kind="module" id={mod.id} ownerId={id} label={`módulo ${mod.name}`} />
                    </div>

                    {/* Submódulos */}
                    <div className="space-y-2 border-t border-border bg-secondary/20 p-4">
                      {mod.submodules.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                        >
                          <Thumb src={sub.photo} size="size-9" fallback={<HardDrive className="size-4" />} />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium">{sub.name}</span>
                            {sub.serialNumber && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                S/N: {sub.serialNumber}
                              </span>
                            )}
                          </div>
                          <DeleteButton kind="submodule" id={sub.id} ownerId={id} label={`submódulo ${sub.name}`} />
                        </div>
                      ))}
                      <AddSubmoduleForm ownerId={id} moduleId={mod.id} />
                    </div>
                  </div>
                ))}

                <AddModuleForm ownerId={id} equipmentId={eq.id} />

                {/* Historial de servicios de este equipo */}
                {(historyByEquipment.get(eq.id)?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-border bg-secondary/20 p-4">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Wrench className="size-3.5" /> Historial de servicios
                    </h4>
                    <ul className="divide-y divide-border">
                      {historyByEquipment.get(eq.id)!.map((tk) => (
                        <li key={tk.id}>
                          <Link
                            href={`/tickets/${tk.id}`}
                            className="flex flex-wrap items-center gap-3 py-2 text-sm hover:opacity-80"
                          >
                            <span className="font-mono text-xs text-primary">{tk.reference}</span>
                            <span className="min-w-0 flex-1 truncate">{tk.subject}</span>
                            <StatusBadge status={tk.status as TicketStatusValue} locale={locale} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
