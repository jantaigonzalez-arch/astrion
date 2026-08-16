import { setRequestLocale } from "next-intl/server";
import { Building2 } from "lucide-react";
import { isSalesRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getClients } from "@/lib/data/crm";
import { currentRole } from "@/lib/tenancy/context";
import { ClientsList, type ClientListRow } from "@/components/portal/clients-list";

/**
 * Clientes: el módulo de la post-venta.
 *
 * Sale de Ventas a propósito. Lo que se hace con un cliente —revisar contratos,
 * mirar su equipo instalado, atender sus tickets— no es vender, y mezclarlo con
 * la prospección obligaba a navegar 141 leads para llegar a los 24 que ya
 * compran. Detrás sigue siendo la misma tabla que los leads: lo que cambia es
 * el trabajo, no la entidad (ver `getClients`).
 *
 * Sin filtro por responsable, al revés que en Leads: una cartera comercial es
 * de quien prospecta, pero un cliente con un ticket abierto es de la empresa
 * entera. Quien contesta el teléfono no puede depender de a quién se le asignó
 * la cuenta hace dos años.
 */
export default async function ClientesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isSalesRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const clients = await getClients();

  // Se aplana a lo que la tabla necesita: el componente es de cliente, así que
  // todo lo que se le pase cruza el límite servidor→cliente serializado.
  const rows: ClientListRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    taxId: c.taxId,
    industry: c.industry,
    ownerName: c.ownerName,
    hasPortal: c.hasPortal,
    contracts: c.contracts,
    equipment: c.equipment,
    openTickets: c.openTickets,
    totalTickets: c.totalTickets,
    // Las fechas no cruzan como `Date`: se serializan y vuelven como texto.
    // Mandarla ya en ISO deja explícito lo que el componente va a recibir.
    lastTicketAt: c.lastTicketAt ? c.lastTicketAt.toISOString() : null,
    wonDeals: c.wonDeals,
    wonValue: c.wonValue,
  }));

  const conAbiertos = rows.filter((r) => r.openTickets > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="size-5 text-primary" />
            Clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} laboratorio(s) y empresa(s) que ya compraron
            {conAbiertos > 0 && (
              <>
                {" "}
                · <span className="font-medium text-warning">{conAbiertos}</span> con
                tickets abiertos
              </>
            )}
            .
          </p>
        </div>
      </div>

      <ClientsList clients={rows} locale={locale} />

      <p className="text-xs text-muted-foreground">
        Es cliente quien tiene un negocio ganado, un contrato firmado o una cuenta
        de portal enlazada. Un lead pasa a esta lista solo cuando compra — no hay
        que moverlo a mano.
      </p>
    </div>
  );
}
