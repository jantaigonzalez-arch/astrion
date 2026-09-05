import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Building2 } from "lucide-react";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { getClients } from "@/lib/data/crm";
import { puedeEn } from "@/lib/tenancy/context";
import { ClientsList, type ClientListRow } from "@/components/portal/clients-list";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { Skeleton, TableSkeleton } from "@/components/portal/skeletons";
import type { ClientRow } from "@/lib/data/crm";

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

  if (!(await puedeEn("clientes", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  /*
    Sin `await`: la promesa se crea aquí y la esperan los dos bloques que la
    necesitan, cada uno dentro de su propio `Suspense`.

    `getClients` es la lectura más cara del portal —una consulta con cinco
    subconsultas correlacionadas por cliente, 38 ms medidos— y esperarla aquí
    dejaba la pantalla en blanco todo ese tiempo, encabezado incluido. Ahora el
    título sale de inmediato y la tabla llega por streaming.

    La MISMA promesa a los dos, y no una llamada por bloque: se lee una vez y
    los dos reciben el resultado. Es la forma que ya usa Rentabilidad para
    repartir su resumen entre cinco bloques.
  */
  const clientes = getClients();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="size-5 text-primary" />
            Clientes
          </h1>
          <Suspense fallback={<Skeleton className="h-5 w-72" />}>
            <Resumen p={clientes} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
        <Lista p={clientes} locale={locale} />
      </Suspense>

      <p className="text-xs text-muted-foreground">
        Es cliente quien tiene un negocio ganado, un contrato firmado o una cuenta
        de portal enlazada. Un lead pasa a esta lista solo cuando compra — no hay
        que moverlo a mano.
      </p>

      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="clientes" />
      </Suspense>
    </div>
  );
}

/** El recuento del encabezado. Espera los mismos datos que la tabla. */
async function Resumen({ p }: { p: Promise<ClientRow[]> }) {
  const clientes = await p;
  const conAbiertos = clientes.filter((c) => c.openTickets > 0).length;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {clientes.length} laboratorio(s) y empresa(s) que ya compraron
        {conAbiertos > 0 && (
          <>
            {" "}
            · <span className="font-medium text-warning">{conAbiertos}</span> con
            tickets abiertos
          </>
        )}
        .
      </p>
      {/* La otra mitad de la frase que empieza en Prospectos. */}
      <p className="text-xs text-muted-foreground">
        Llegan aquí desde{" "}
        <Link href="/admin/crm/prospectos" className="text-primary hover:underline">
          Prospectos
        </Link>{" "}
        al ganarse un negocio. Es la misma ficha, con más cosas que atender.
      </p>
    </>
  );
}

/**
 * La tabla.
 *
 * Aplana a lo que la tabla necesita: el componente es de cliente, así que todo
 * lo que se le pase cruza el límite servidor→cliente serializado.
 */
async function Lista({ p, locale }: { p: Promise<ClientRow[]>; locale: string }) {
  const clientes = await p;

  const rows: ClientListRow[] = clientes.map((c) => ({
    id: c.id,
    name: c.name,
    taxId: c.taxId,
    industry: c.industry,
    phone: c.phone,
    contacts: c.contacts,
    ownerName: c.ownerName,
    slaHours: c.slaHours,
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

  return <ClientsList clients={rows} locale={locale} />;
}
