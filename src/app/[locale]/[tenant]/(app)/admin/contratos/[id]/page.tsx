import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  Boxes,
  Building2,
  CalendarDays,
  Cpu,
  Handshake,
  HardDrive,
  Lock,
  Mail,
  Pencil,
  Phone,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wrench,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import {
  getContractById,
  getTicketsForEquipmentIds,
  getProfitInputsForTickets,
} from "@/lib/data/contracts";
import { getSettings } from "@/lib/data/settings";
import { computeProfit, sumProfits, mxn } from "@/lib/profit";
import { contractInsights } from "@/lib/ml/insights";
import { InsightStrip } from "@/components/portal/insight-strip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { StatusBadge } from "@/components/portal/badges";
import type { TicketStatusValue } from "@/lib/tickets";
import { currentRole } from "@/lib/tenancy/context";

function money(v: string | null, currency: "MXN" | "USD", locale: string) {
  if (!v) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = isAdminRole(await currentRole());

  const contract = await getContractById(id);
  if (!contract) notFound();
  // El vendedor solo puede abrir sus propios contratos.
  if (!admin && contract.salesRepId !== session!.user.id) notFound();

  /*
    Solo cuenta el equipo que de verdad es de este cliente.

    Un contrato puede tener enlazado equipo de OTRO laboratorio —el importador
    los enlazó por número de serie sin mirar el dueño, y hay tres casos así en
    los datos—. Como los servicios se buscan por equipo y no por cliente, eso
    hacía que esta pantalla mostrara los tickets de otro laboratorio, con sus
    horas y refacciones sumando a la utilidad del contrato.

    Se separan en vez de filtrarse en silencio: los ajenos se siguen listando
    abajo, marcados, porque son un error de datos que alguien tiene que
    resolver —puede que el equipo esté en ese laboratorio y el dueño registrado
    esté mal— y esconderlos garantizaría que nadie lo arregle nunca. Lo que no
    hacen es entrar en los números ni enseñar servicios ajenos.
  */
  const ownedLinks = contract.equipmentLinks.filter(
    (l) => l.equipment?.ownerId === contract.clientId,
  );
  const foreignLinks = contract.equipmentLinks.filter(
    (l) => l.equipment?.ownerId !== contract.clientId,
  );

  const equipmentIds = ownedLinks.map((l) => l.equipmentId);
  const serviceTickets = await getTicketsForEquipmentIds(equipmentIds);

  // Rentabilidad consolidada: utilidad de cada servicio + consumo del contrato.
  const appSettings = await getSettings();
  const inputs = await getProfitInputsForTickets(serviceTickets.map((t) => t.id));
  const perTicket = new Map(
    inputs.map((i) => [
      i.ticketId,
      computeProfit({
        hours: i.hours,
        parts: i.parts,
        laborCostPerHour: appSettings.laborCostPerHour,
        laborRatePerHour: appSettings.laborRatePerHour,
      }),
    ]),
  );
  const consolidated = sumProfits(Array.from(perTicket.values()));
  const contractAmount = Number(contract.amountMxn ?? 0);
  // Utilidad del contrato: monto pactado menos lo que costó atenderlo.
  const contractProfit = contractAmount - consolidated.cost;
  const contractMargin =
    contractAmount > 0 ? (contractProfit / contractAmount) * 100 : 0;
  const consumedPct =
    contractAmount > 0 ? (consolidated.cost / contractAmount) * 100 : 0;

  // El costo consumido se le PASA al resolutor en vez de que lo recalcule: esta
  // pantalla ya lo tiene. La capa solo consulta lo que es suyo —las
  // predicciones de los servicios abiertos—. Ver la garantía 3 de insights.ts.
  const insights = await contractInsights({
    contractId: contract.id,
    amountMxn: contract.amountMxn ? Number(contract.amountMxn) : null,
    equipmentIds,
    consumedCost: consolidated.cost,
    laborCostPerHour: appSettings.laborCostPerHour,
  });

  const loc = locale === "en" ? "en-US" : "es-MX";
  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(loc, { dateStyle: "long" }) : "—";

  // Vigencia: días restantes y estado.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = contract.endDate ? new Date(contract.endDate + "T00:00:00") : null;
  const start = contract.startDate ? new Date(contract.startDate + "T00:00:00") : null;
  const daysLeft = end
    ? Math.ceil((end.getTime() - today.getTime()) / 86_400_000)
    : null;

  let statusLabel = "Sin vigencia definida";
  let statusStyle = "bg-muted text-muted-foreground ring-border";
  if (end && daysLeft !== null) {
    if (daysLeft < 0) {
      statusLabel = "Vencido";
      statusStyle = "bg-destructive/12 text-destructive ring-destructive/25";
    } else if (daysLeft <= 30) {
      statusLabel = `Por vencer · ${daysLeft} día(s)`;
      statusStyle = "bg-warning/15 text-warning ring-warning/30";
    } else if (start && start > today) {
      statusLabel = "Por iniciar";
      statusStyle = "bg-primary/10 text-primary ring-primary/20";
    } else {
      statusLabel = `Vigente · ${daysLeft} día(s)`;
      statusStyle = "bg-success/15 text-success ring-success/25";
    }
  }

  const ticketsByEquipment = new Map<string, typeof serviceTickets>();
  for (const t of serviceTickets) {
    if (!t.equipmentId) continue;
    const arr = ticketsByEquipment.get(t.equipmentId) ?? [];
    arr.push(t);
    ticketsByEquipment.set(t.equipmentId, arr);
  }

  // Los módulos se cuentan sobre lo amparado DE VERDAD, igual que el resto de
  // los números de esta pantalla.
  const totalModules = ownedLinks.reduce((a, l) => a + l.equipment.modules.length, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Esta pantalla conserva la tira en el cuerpo: su análisis se apoya en
          lo que la página ya calculó, así que no puede vivir en el asistente
          de la barra sin repetir ese trabajo. Ver `lib/ml/assistant.ts`. */}
      <InsightStrip insights={insights} />

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {contract.number}
            </h1>
            <Badge className={statusStyle}>{statusLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {contract.client.company ?? contract.client.name ?? contract.client.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Button asChild variant="accent" size="sm">
              <Link href={`/admin/contratos/${contract.id}/editar`}>
                <Pencil className="size-4" /> Editar
              </Link>
            </Button>
          )}
          {admin && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/equipos/${contract.client.id}`}>
                Equipos del lab
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/contratos">← Contratos</Link>
          </Button>
        </div>
      </div>

      {/* Montos y vigencia */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Costo (MXN)
          </span>
          <div className="mt-1.5 text-2xl font-semibold">
            {money(contract.amountMxn, "MXN", locale)}
          </div>
        </Card>
        <Card className="p-5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Costo (USD)
          </span>
          <div className="mt-1.5 text-2xl font-semibold">
            {money(contract.amountUsd, "USD", locale)}
          </div>
        </Card>
        <Card className="p-5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Equipos amparados
          </span>
          <div className="mt-1.5 text-2xl font-semibold">
            {ownedLinks.length}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              · {totalModules} módulo(s)
            </span>
          </div>
        </Card>
        <Card className="p-5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Servicios
          </span>
          <div className="mt-1.5 text-2xl font-semibold">{serviceTickets.length}</div>
        </Card>
      </div>

      {/* Partes */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-primary" /> Laboratorio
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="font-medium">
              {contract.client.company ?? "—"}
            </div>
            <div className="text-muted-foreground">{contract.client.name ?? "—"}</div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-3.5" /> {contract.client.email}
            </div>
            {contract.client.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-3.5" /> {contract.client.phone}
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <UserRound className="size-4 text-primary" /> Vendedor responsable
          </h2>
          <div className="space-y-2 text-sm">
            <div className="font-medium">
              {contract.salesRep?.name ?? "Sin asignar"}
            </div>
            {contract.salesRep?.email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="size-3.5" /> {contract.salesRep.email}
              </div>
            )}
          </div>

          <h2 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-primary" /> Vigencia
          </h2>
          <p className="text-sm text-muted-foreground">
            {fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}
          </p>

          {/* Trazabilidad comercial: de qué negocio del CRM salió el contrato */}
          {contract.deal && (
            <>
              <h2 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold">
                <Handshake className="size-4 text-primary" /> Negocio de origen
              </h2>
              <Link
                href={`/admin/crm/negocios/${contract.deal.id}`}
                className="block text-sm font-medium text-primary hover:underline"
              >
                {contract.deal.title}
              </Link>
              <p className="font-mono text-xs text-muted-foreground">
                {contract.deal.reference}
              </p>
            </>
          )}
        </Card>
      </div>

      {/* Rentabilidad del contrato (interno) */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            {contractProfit >= 0 ? (
              <TrendingUp className="size-4 text-success" />
            ) : (
              <TrendingDown className="size-4 text-destructive" />
            )}
            Rentabilidad del contrato
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> interno
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Monto del contrato
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {mxn(contractAmount)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Costo de servicios
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {mxn(consolidated.cost)}
            </div>
            <div className="text-xs text-muted-foreground">
              {consolidated.hours} h · {serviceTickets.length} servicio(s)
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Utilidad
            </div>
            <div
              className={`mt-1 text-xl font-semibold tabular-nums ${
                contractProfit >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {mxn(contractProfit)}
            </div>
            <div className="text-xs text-muted-foreground">
              margen {contractMargin.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Consumido
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {consumedPct.toFixed(1)}%
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${
                  consumedPct > 90
                    ? "bg-destructive"
                    : consumedPct > 70
                      ? "bg-warning"
                      : "bg-success"
                }`}
                style={{ width: `${Math.min(100, consumedPct)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Desglose de costos */}
        <div className="mt-4 grid gap-x-8 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Costo de refacciones</span>
            <span className="tabular-nums">{mxn(consolidated.partsCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Costo de mano de obra</span>
            <span className="tabular-nums">{mxn(consolidated.laborCost)}</span>
          </div>
        </div>
      </Card>

      {/* Equipos amparados, con desglose */}
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Boxes className="size-4 text-primary" />
          <h2 className="font-semibold">Equipos amparados</h2>
        </div>

        {/*
          Enlaces que apuntan a equipo de otro laboratorio.

          Se muestran, no se esconden: son un error de datos que hay que
          resolver mirando la realidad —o el equipo no es de este contrato, o el
          dueño registrado del equipo está mal— y solo quien conoce la operación
          puede decir de qué lado se corrige. Fuera de este aviso no participan
          en nada: ni en el conteo, ni en la lista, ni en los servicios, ni en
          la utilidad.
        */}
        {foreignLinks.length > 0 && (
          <div className="border-b border-warning/30 bg-warning/5 px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <HardDrive className="size-4" />
              {foreignLinks.length} equipo(s) enlazado(s) que no son de este cliente
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Quedan fuera de los totales y de los servicios de arriba. Revisa si
              el equipo pertenece a este contrato o si su dueño está mal
              registrado.
            </p>
            <ul className="mt-2 space-y-1">
              {foreignLinks.map(({ equipment: eq }) => (
                <li key={eq.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {eq.brand} {eq.name}
                  </span>
                  {eq.model && <span className="font-mono"> · {eq.model}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ownedLinks.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Este contrato no ampara equipos.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {ownedLinks.map(({ equipment: eq }) => {
              const hist = ticketsByEquipment.get(eq.id) ?? [];
              return (
                <div key={eq.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-primary/10 text-primary ring-primary/20">
                      {eq.brand}
                    </Badge>
                    <span className="font-semibold">{eq.name}</span>
                    {eq.model && (
                      <span className="text-sm text-muted-foreground">· {eq.model}</span>
                    )}
                  </div>

                  {/* Módulos y submódulos con series */}
                  {eq.modules.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {eq.modules.map((m) => (
                        <li
                          key={m.id}
                          className="rounded-lg border border-border bg-secondary/25 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Cpu className="size-3.5 text-signal-bright" />
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">{m.brand}</span>
                            {m.serialNumber && (
                              <span className="font-mono text-xs text-muted-foreground">
                                S/N {m.serialNumber}
                              </span>
                            )}
                          </div>
                          {m.submodules.length > 0 && (
                            <ul className="mt-2 space-y-1 pl-6">
                              {m.submodules.map((s) => (
                                <li
                                  key={s.id}
                                  className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                                >
                                  <HardDrive className="size-3" />
                                  <span>{s.name}</span>
                                  {s.serialNumber && (
                                    <span className="font-mono">S/N {s.serialNumber}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Servicios de este equipo bajo el contrato */}
                  {hist.length > 0 && (
                    <div className="mt-3 rounded-lg border border-border p-3">
                      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Wrench className="size-3.5" /> Servicios ({hist.length})
                      </h4>
                      <ul className="divide-y divide-border">
                        {hist.map((t) => (
                          <li key={t.id}>
                            <Link
                              href={`/tickets/${t.id}`}
                              className="flex flex-wrap items-center gap-3 py-2 text-sm hover:opacity-80"
                            >
                              <span className="font-mono text-xs text-primary">
                                {t.reference}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                              <StatusBadge
                                status={t.status as TicketStatusValue}
                                locale={locale}
                              />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {contract.notes && (
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">Notas</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {contract.notes}
          </p>
        </Card>
      )}
    </div>
  );
}
