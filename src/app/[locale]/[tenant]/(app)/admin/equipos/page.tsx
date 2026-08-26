import { setRequestLocale } from "next-intl/server";
import { Cpu, HardDrive } from "lucide-react";
import { isSupport, isSalesRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";
import {
  CAMPOS_ORDEN_EQUIPOS,
  CONTRATO_FILTROS,
  ORDEN_EQUIPOS_DEFECTO,
  conteosEquipos,
  countEquipment,
  getEquipmentList,
} from "@/lib/data/equipment";
import { parsePage } from "@/lib/pagination";
import { INICIAL, parseFiltro, parseOrden, queryLimpia } from "@/lib/listado";
import { Pagination } from "@/components/portal/pagination";
import {
  BarraFiltros,
  FiltroFichas,
  ThOrden,
} from "@/components/portal/listado-controles";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";

const BASE = "/admin/equipos";

/**
 * El parque instalado de toda la empresa.
 *
 * Esta pantalla no existía y su ausencia era un 404: el directorio tenía la
 * ficha por laboratorio (`/admin/equipos/<clienteId>`) pero ninguna portada, y
 * tres análisis enlazaban aquí —«equipos próximos a requerir servicio», «de qué
 * marcas es el parque instalado» y «equipos que más servicio consumen»—. Quien
 * pulsaba «ver a detalle» en cualquiera de los tres aterrizaba en una página que
 * no existe.
 *
 * Arranca ordenada por SERVICIOS y no por nombre, al revés que los otros
 * listados: a un inventario de equipo ajeno no se viene a buscar uno concreto
 * —para eso se entra por su laboratorio— sino a ver cuál está dando guerra.
 */
export default async function EquiposPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    por?: string;
    orden?: string;
    dir?: string;
    marca?: string;
    laboratorio?: string;
    contrato?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Mismo criterio que la ficha: soporte trabaja con el equipo y ventas necesita
  // saber qué tiene instalado cada cuenta.
  const rol = await currentRole();
  if (!isSupport(rol) && !isSalesRole(rol)) {
    await redirectInTenant("/dashboard", locale);
  }

  const sp = await searchParams;
  const pageParams = parsePage(sp);
  const orden = parseOrden(sp, CAMPOS_ORDEN_EQUIPOS, ORDEN_EQUIPOS_DEFECTO);
  const filtros = {
    marca: sp.marca,
    laboratorio: sp.laboratorio,
    contrato: parseFiltro(sp.contrato, CONTRATO_FILTROS),
  };
  const query = queryLimpia({
    marca: filtros.marca,
    laboratorio: filtros.laboratorio,
    contrato: filtros.contrato,
    orden: orden.campo,
    dir: orden.dir,
    por: sp.por,
  });

  const [filas, total, conteos, totalSinFiltros] = await Promise.all([
    getEquipmentList({
      limit: pageParams.perPage,
      offset: pageParams.offset,
      orden,
      filtros,
    }),
    countEquipment(filtros),
    conteosEquipos(filtros),
    countEquipment(),
  ]);

  const hayFiltros =
    Boolean(filtros.marca || filtros.laboratorio || filtros.contrato) ||
    orden.campo !== ORDEN_EQUIPOS_DEFECTO.campo ||
    orden.dir !== ORDEN_EQUIPOS_DEFECTO.dir;

  const fecha = (d: Date) =>
    d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parque instalado</h1>
          <p className="text-sm text-muted-foreground">
            {totalSinFiltros} equipo(s) bajo cuidado de la empresa.
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        {totalSinFiltros > 0 && (
          <BarraFiltros hayFiltros={hayFiltros} basePath={BASE}>
            <FiltroFichas
              titulo="Marca"
              clave="marca"
              activo={filtros.marca}
              basePath={BASE}
              query={query}
              opciones={[
                { label: "Todas" },
                ...conteos.marca.map((m) => ({ valor: m.k, label: m.k, n: m.n })),
              ]}
            />
            <FiltroFichas
              titulo="Contrato"
              clave="contrato"
              activo={filtros.contrato}
              basePath={BASE}
              query={query}
              opciones={[
                { label: "Todos" },
                { valor: "con", label: "Amparados", n: conteos.contrato.get("con") ?? 0 },
                // El que importa: equipo que se atiende sin contrato detrás.
                { valor: "sin", label: "Sin contrato", n: conteos.contrato.get("sin") ?? 0 },
              ]}
            />
            <FiltroFichas
              titulo="Laboratorio"
              clave="laboratorio"
              activo={filtros.laboratorio}
              basePath={BASE}
              query={query}
              opciones={[
                { label: "Todos" },
                // Los ocho con más equipo. Con veinticuatro laboratorios, la
                // fila de fichas ocuparía media pantalla y dejaría de leerse;
                // para los demás está el filtro desde su propia ficha.
                ...conteos.laboratorio.slice(0, 8).map((l) => ({
                  valor: l.id,
                  label: l.nombre.split(" ").slice(0, 2).join(" "),
                  n: l.n,
                })),
              ]}
            />
          </BarraFiltros>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThOrden campo="nombre" actual={orden} basePath={BASE} query={query}>
                  Equipo
                </ThOrden>
                <ThOrden campo="marca" actual={orden} basePath={BASE} query={query}>
                  Marca
                </ThOrden>
                <ThOrden campo="laboratorio" actual={orden} basePath={BASE} query={query}>
                  Laboratorio
                </ThOrden>
                <ThOrden
                  campo="modulos"
                  actual={orden}
                  basePath={BASE}
                  query={query}
                  inicial={INICIAL.numero}
                >
                  Módulos
                </ThOrden>
                <ThOrden
                  campo="servicios"
                  actual={orden}
                  basePath={BASE}
                  query={query}
                  inicial={INICIAL.numero}
                >
                  Servicios
                </ThOrden>
                <th className="px-4 py-3 font-medium">Contrato</th>
                <ThOrden
                  campo="alta"
                  actual={orden}
                  basePath={BASE}
                  query={query}
                  inicial={INICIAL.fecha}
                >
                  Alta
                </ThOrden>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filas.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-secondary/40">
                  <td className="max-w-xs px-4 py-3">
                    {/*
                      La ficha de equipos se abre POR LABORATORIO —esa es la
                      ruta que existe— así que el enlace lleva al inventario de
                      su dueño y no a una ficha por equipo, que no hay.
                    */}
                    <Link
                      href={`/admin/equipos/${e.ownerId}`}
                      className="font-medium hover:text-primary"
                    >
                      {e.name}
                    </Link>
                    {e.model && (
                      <p className="text-xs text-muted-foreground">{e.model}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {e.brand ?? "—"}
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-muted-foreground">
                    {e.ownerName ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <HardDrive className="size-3.5 text-muted-foreground" />
                      {e.modulos}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{e.servicios}</td>
                  <td className="px-4 py-3">
                    {e.enContrato ? (
                      <Badge className="bg-primary/10 text-primary ring-primary/20">
                        Amparado
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground tabular-nums">
                    {fecha(e.createdAt)}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Cpu className="mx-auto mb-3 size-8 text-primary" />
                    {hayFiltros
                      ? "Ningún equipo coincide con estos filtros."
                      : "Todavía no hay equipos registrados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination {...pageParams} total={total} basePath={BASE} query={query} />
      </Card>
    </div>
  );
}
