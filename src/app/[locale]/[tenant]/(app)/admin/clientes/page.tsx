import { Suspense } from "react";
import { getSettings } from "@/lib/data/settings";
import { setRequestLocale } from "next-intl/server";
import { Building2 } from "lucide-react";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { countClients, getClients, type CampoCartera } from "@/lib/data/crm";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";

/** Las fichas de filtro de esta pantalla. */
type Filtro = "all" | "conAbiertos" | "sinPortal";

/*
  Los campos por los que se puede ordenar, para validar lo que llega en la URL.

  Se comprueba en vez de confiar: `?campo=<lo que sea>` viene de fuera, y un
  campo desconocido tiene que caer al orden por omisión, no llegar a la consulta.
*/
const CAMPOS: readonly string[] = [
  "nombre", "fiscal", "rfc", "contactos", "contratos",
  "equipos", "tickets", "ultimo", "comprado", "sla", "responsable",
];
import { puedeEn } from "@/lib/tenancy/context";
import { ClientsList, type ClientListRow } from "@/components/portal/clients-list";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { Skeleton, TableSkeleton } from "@/components/portal/skeletons";
import type { ClientRow } from "@/lib/data/crm";
import { BotonDescargar } from "@/components/portal/boton-descargar";

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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    por?: string;
    q?: string;
    filtro?: string;
    campo?: string;
    dir?: string;
  }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
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
  /*
    ── LA CARTERA SE PIDE POR PÁGINAS ──────────────────────────────────────

    Antes se traía ENTERA y la pantalla dibujaba todas las filas. Con 23
    clientes daba igual; medido con 2 088, la consulta subía a 51 ms y el
    navegador recibía dos mil renglones de HTML para enseñar veinticinco.

    Y la paginación arrastra a la búsqueda y al orden: si se recorta en el
    servidor y se busca en el navegador, se buscaría solo dentro de la página
    que se está mirando. Las tres decisiones viajan juntas en la URL.
  */
  const pageParams = parsePage(sp);
  const q = (sp.q ?? "").trim();
  const filtro: Filtro =
    sp.filtro === "conAbiertos" || sp.filtro === "sinPortal" ? sp.filtro : "all";
  const orden = {
    campo: (CAMPOS.includes(sp.campo as CampoCartera) ? sp.campo : "nombre") as CampoCartera,
    dir: sp.dir === "desc" ? ("desc" as const) : ("asc" as const),
  };

  /*
    Sin `await`: las promesas se crean aquí y las esperan los bloques que las
    necesitan, cada uno en su `Suspense`. El encabezado sale de inmediato.

    Los conteos de las fichas —«Todos», «Con tickets abiertos», «Sin cuenta»— se
    piden SIN el filtro puesto, porque tienen que decir cuántos hay en total y no
    cuántos quedan después de filtrar. Un filtro que muestra su propio resultado
    como total no deja volver.
  */
  const filas = getClients(undefined, {
    ...orden,
    q,
    filtro,
    limit: pageParams.perPage,
    offset: pageParams.offset,
  });
  const total = countClients({ q, filtro });
  const conteos = Promise.all([
    countClients(),
    countClients({ filtro: "conAbiertos" }),
    countClients({ filtro: "sinPortal" }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="size-5 text-primary" />
            Clientes
          </h1>
          <Suspense fallback={<Skeleton className="h-5 w-72" />}>
            <Resumen total={total} conteos={conteos} />
          </Suspense>
        </div>

        <BotonDescargar dataset="clientes" />
      </div>

      <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
        <Lista
          p={filas}
          total={total}
          conteos={conteos}
          locale={locale}
          q={q}
          filtro={filtro}
          orden={orden}
          pageParams={pageParams}
        />
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

/**
 * El recuento del encabezado.
 *
 * Cuenta contra la BASE y no sobre las filas que hay a mano. Con la lista
 * paginada, contar lo que se ve diría «25 laboratorios» cuando hay doscientos.
 */
async function Resumen({
  total,
  conteos,
}: {
  total: Promise<number>;
  conteos: Promise<[number, number, number]>;
}) {
  const [, conAbiertos] = await conteos;
  const clientes = { length: await total };

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
async function Lista({
  p,
  total,
  conteos,
  locale,
  q,
  filtro,
  orden,
  pageParams,
}: {
  p: Promise<ClientRow[]>;
  total: Promise<number>;
  conteos: Promise<[number, number, number]>;
  locale: string;
  q: string;
  filtro: Filtro;
  orden: { campo: CampoCartera; dir: "asc" | "desc" };
  pageParams: ReturnType<typeof parsePage>;
}) {
  const [clientes, cuantos, [totalSinFiltro, conAbiertos, sinPortal], ajustes] = await Promise.all([
    p,
    total,
    conteos,
    getSettings(),
  ]);

  const rows: ClientListRow[] = clientes.map((c) => ({
    id: c.id,
    name: c.name,
    taxId: c.taxId,
    rfcFiscal: c.rfcFiscal,
    cpFiscal: c.cpFiscal,
    regimenFiscal: c.regimenFiscal,
    validacion: c.validacion,
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

  return (
    <div className="space-y-4">
      <ClientsList
        clients={rows}
        locale={locale}
        total={cuantos}
        q={q}
        filtro={filtro}
        orden={orden}
        basePath="/admin/clientes"
        totalSinFiltro={totalSinFiltro}
        conAbiertos={conAbiertos}
        sinPortal={sinPortal}
        slaGeneral={ajustes.clientesSlaHoras}
      />
      {/*
        El paginador conserva búsqueda, filtro y orden. Sin eso, pasar a la
        página dos devolvería la cartera entera sin filtrar y parecería que el
        filtro se apagó solo.
      */}
      <Pagination
        {...pageParams}
        total={cuantos}
        basePath="/admin/clientes"
        query={{
          q: q || undefined,
          filtro: filtro === "all" ? undefined : filtro,
          campo: orden.campo === "nombre" ? undefined : orden.campo,
          dir: orden.dir === "asc" ? undefined : orden.dir,
        }}
      />
    </div>
  );
}
