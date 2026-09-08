import { Suspense } from "react";
import {
  CAMPOS_ORDEN_ORDENES,
  ORDEN_ORDENES_DEFECTO,
  contarOrdenes,
} from "@/lib/data/purchasing";
import { parseFiltro, parseOrden, queryLimpia } from "@/lib/listado";
import { ResumenFiltros, ThOrden } from "@/components/portal/listado-controles";
import { FiltroColumna } from "@/components/portal/filtro-columna";
import { PURCHASE_STATUS_LABEL } from "@/lib/domain/purchasing";
import { purchaseOrderStatus } from "@/lib/db/schema";
import { setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { getPurchaseOrders } from "@/lib/data/purchasing";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { PurchaseStatusBadge } from "@/components/portal/purchasing/status-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import type { PurchaseOrderStatus } from "@/lib/db/schema";
import { puedeEn } from "@/lib/tenancy/context";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { AnalysisSection, AnalysisSectionSkeleton } from "@/components/portal/analysis-section";
import { BotonDescargar } from "@/components/portal/boton-descargar";

const BASE = "/admin/compras";

export default async function ComprasPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    por?: string;
    orden?: string;
    dir?: string;
    estado?: string;
    proveedor?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  // La página llega por la URL, o sea de fuera: `parsePage` es el único sitio
  // donde deja de ser texto ajeno y pasa a ser un entero acotado.
  const sp = await searchParams;
  const pageParams = parsePage(sp);
  // El orden viaja con la página: cambiar de columna y perder la página en la
  // que estabas es lo mismo que no haber ordenado. Ver `queryLimpia`.
  const orden = parseOrden(sp, CAMPOS_ORDEN_ORDENES, ORDEN_ORDENES_DEFECTO);
  const filtros = {
    estado: parseFiltro(sp.estado, purchaseOrderStatus.enumValues),
    proveedor: sp.proveedor,
  };
  const query = queryLimpia({
    estado: filtros.estado,
    proveedor: filtros.proveedor,
  });

  const [{ rows: orders, total }, conteos] = await Promise.all([
    getPurchaseOrders(
      { limit: pageParams.perPage, offset: pageParams.offset },
      orden,
      filtros,
    ),
    contarOrdenes(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Órdenes de compra
          </h1>
          <p className="text-sm text-muted-foreground">
            Lo que se pide a proveedor. Lo que se recibe entra al inventario.
          </p>
        </div>
        {/* Proveedores salió de aquí: ahora es su propio renglón del menú, al
            lado de este. Un botón que lleva a otra sección hacía parecer que
            los proveedores vivían dentro de las órdenes. */}
        <div className="flex flex-wrap items-center gap-2">
          <BotonDescargar dataset="compras" query={query} />
          <Button asChild variant="accent">
            <Link href="/admin/compras/nueva">
              <Plus className="size-4" /> Nueva orden
            </Link>
          </Button>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay órdenes de compra.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando registres una y la recibas, las piezas van a entrar solas al
            inventario y el historial de costos empieza a construirse.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ResumenFiltros
            basePath={BASE}
            query={query}
            puestos={[
              filtros.estado && {
                clave: "estado",
                titulo: "Estado",
                valor: PURCHASE_STATUS_LABEL[filtros.estado],
              },
              filtros.proveedor && {
                clave: "proveedor",
                titulo: "Proveedor",
                valor:
                  conteos.proveedor.find((p) => p.k === filtros.proveedor)?.label ??
                  filtros.proveedor,
              },
            ].filter((x): x is { clave: string; titulo: string; valor: string } =>
              Boolean(x),
            )}
          />
          <div className="overflow-x-auto">
            <table data-tabla="ordenes" className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <ThOrden campo="folio" actual={orden} basePath={BASE} query={query}>
                    Folio
                  </ThOrden>
                  <ThOrden
                    campo="proveedor"
                    actual={orden}
                    basePath={BASE}
                    query={query}
                    filtro={
                      <FiltroColumna
                        titulo="Proveedor"
                        clave="proveedor"
                        activo={filtros.proveedor}
                        basePath={BASE}
                        query={query}
                        opciones={[
                          { label: "Todos" },
                          ...conteos.proveedor.map((p) => ({
                            valor: p.k,
                            label: p.label,
                            n: p.n,
                          })),
                        ]}
                      />
                    }
                  >
                    Proveedor
                  </ThOrden>
                  <ThOrden
                    campo="estado"
                    actual={orden}
                    basePath={BASE}
                    query={query}
                    filtro={
                      <FiltroColumna
                        titulo="Estado"
                        clave="estado"
                        activo={filtros.estado}
                        basePath={BASE}
                        query={query}
                        opciones={[
                          { label: "Todos" },
                          ...purchaseOrderStatus.enumValues.map((e) => ({
                            valor: e,
                            label: PURCHASE_STATUS_LABEL[e],
                            n: conteos.estado.find((c) => c.k === e)?.n ?? 0,
                          })),
                        ]}
                      />
                    }
                  >
                    Estado
                  </ThOrden>
                  <ThOrden campo="piezas" actual={orden} basePath={BASE} query={query} numerica>
                    Piezas
                  </ThOrden>
                  <ThOrden campo="total" actual={orden} basePath={BASE} query={query} numerica>
                    Total
                  </ThOrden>
                  <ThOrden campo="espera" actual={orden} basePath={BASE} query={query} inicial="asc">
                    Se espera
                  </ThOrden>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/compras/${o.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {o.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{o.supplierName}</td>
                    <td className="px-4 py-3">
                      <PurchaseStatusBadge status={o.status as PurchaseOrderStatus} />
                    </td>
                    {/* Recibido sobre pedido: es el dato que dice si la orden
                        sigue viva, y leerlo de un vistazo evita abrirla. */}
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          o.received < o.units ? "text-foreground" : "text-muted-foreground"
                        }
                      >
                        {o.received}
                      </span>
                      <span className="text-muted-foreground"> / {o.units}</span>
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {money(o.total, o.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {o.expectedAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Dentro de la tarjeta y pegado a la tabla: el recuento («26–50 de
              2 612») es parte de la tabla, no un control suelto debajo. */}
          <Pagination {...pageParams} total={total} basePath="/admin/compras" />
        </Card>
      )}
      {/* Debajo de las órdenes, que es lo que se viene a atender.

          En `Suspense` para que la pantalla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/compras" />
      </Suspense>


      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="compras" />
      </Suspense>
    </div>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
