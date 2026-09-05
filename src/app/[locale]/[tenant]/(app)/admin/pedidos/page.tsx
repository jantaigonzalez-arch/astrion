import { setRequestLocale } from "next-intl/server";
import { TriangleAlert } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { getSalesOrders, getSalesOrdersSummary, type SalesOrderRow } from "@/lib/data/crm";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";

/**
 * Pedidos: los negocios ganados, vistos desde la operación.
 *
 * Es la misma fila de la base que el CRM llama «negocio», pero la pregunta que
 * se le hace aquí es otra. Para ventas el negocio TERMINÓ el día que se ganó;
 * para operación ese día EMPIEZA: hay que surtirlo. Por eso esta lista no
 * ordena por valor ni por fecha de cierre, sino por lo que sigue debiendo.
 */
export default async function PedidosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; por?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // `isInternal` y no `isSupport`: el vendedor tiene que poder contestarle al
  // cliente si su pedido ya se está comprando. Ver el estado no es lo mismo que
  // moverlo — requisitar y autorizar siguen siendo de operación.
  /*
    ESTO CIERRA UN AGUJERO, y el cambio es deliberado.

    El guardia era `isInternal`, o sea que un agente podía abrir esta pantalla
    escribiendo la dirección — pero NUNCA la tuvo en su menú, porque la sección
    Ventas no es suya. Es exactamente la discrepancia que la cabecera de
    `portal/menu.ts` cuenta con el tablero de Ventas: la barra escondía y la URL
    enseñaba.

    Con el permiso por módulo la barra y el guardia leen la misma regla, así que
    la puerta se cierra sola. Comprobado antes de tocarlo: nada enlaza aquí
    salvo la barra lateral, y la requisición no nace de esta pantalla sino de la
    ficha del negocio, que vive bajo `/admin/crm` y que un agente tampoco podía
    abrir. Ningún camino de trabajo se rompe.

    Si algún día un agente tiene que ver los pedidos, ahora hay cómo decirlo sin
    convertirlo en vendedor: Ventas en «Ver», desde su ficha.
  */
  if (!(await puedeEn("ventas", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const pageParams = parsePage(await searchParams);
  /*
    El recuento va POR SEPARADO y no contando las filas traídas.

    «3 pedidos tienen algo por comprar» es una cifra del conjunto entero; sacarla
    de la página visible la habría convertido en «3 en esta pantalla», que suena
    igual y dice otra cosa. Es el riesgo silencioso de paginar una lista que
    también resume: la lista se acorta a la vista y el resumen se acorta sin que
    nadie lo pida.
  */
  const [pedidos, resumen] = await Promise.all([
    getSalesOrders({ limit: pageParams.perPage, offset: pageParams.offset }),
    getSalesOrdersSummary(),
  ]);
  const pendientes = resumen.pendientes;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
        <p className="text-sm text-muted-foreground">
          Lo que se vendió y hay que surtir. De aquí salen las requisiciones.
        </p>
      </div>

      {resumen.total === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay pedidos.</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
            Un pedido es un negocio ganado. Al marcar uno como ganado en el
            embudo aparece aquí, con sus productos listos para requisitar.
          </p>
        </Card>
      ) : (
        <>
          {pendientes > 0 && (
            <p className="text-sm text-muted-foreground">
              {pendientes} {pendientes === 1 ? "pedido tiene" : "pedidos tienen"}{" "}
              piezas requisitadas sin convertir en orden.
            </p>
          )}

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="tabla-erp w-full text-sm">
                <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Folio</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Concepto</th>
                    <th data-num className="px-4 py-3 text-right font-medium">Renglones</th>
                    <th className="px-4 py-3 font-medium">Surtido</th>
                    <th data-num className="px-4 py-3 text-right font-medium">Por comprar</th>
                    <th data-num className="px-4 py-3 text-right font-medium">Valor</th>
                    <th className="px-4 py-3 font-medium">Ganado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pedidos.map((p) => (
                    <tr key={p.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/crm/negocios/${p.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {p.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{p.organization ?? "—"}</td>
                      <td className="max-w-xs truncate px-4 py-3">{p.title}</td>
                      <td data-num className="px-4 py-3 text-right tabular-nums">
                        {p.lineas || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Surtido pedido={p} />
                          {p.sinIdentificar > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-warning"
                              title={`${p.sinIdentificar} renglones sin refacción del catálogo`}
                            >
                              <TriangleAlert className="size-3.5" />
                              {p.sinIdentificar}
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-num className="px-4 py-3 text-right tabular-nums">
                        {p.porComprar > 0 ? (
                          p.porComprar
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td data-num className="px-4 py-3 text-right tabular-nums">
                        {p.valueMxn ? money(Number(p.valueMxn)) : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.closedAt ? fecha(p.closedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pageParams} total={resumen.total} basePath="/admin/pedidos" />
          </Card>

          {/* Lo que la columna NO dice, dicho aquí y no en un tooltip que nadie
              abre. «Sin requisitar» es ambiguo por construcción: puede ser que
              falte comprar o que estuviera todo en almacén, y la única forma de
              saberlo es la resta, que vive en el pedido. Prometer aquí una
              certeza que no se tiene sería peor. */}
          <p className="max-w-3xl text-xs text-muted-foreground">
            <span className="font-medium">Sin requisitar</span> no quiere decir
            que falte comprar: puede que el pedido se surta entero con lo que hay
            en almacén. La resta exacta —pedido menos existencia, menos lo que
            viene en camino, menos lo que ya está en trámite— está dentro del pedido, en
            «Surtido y compras».
          </p>
        </>
      )}
    </div>
  );
}

/**
 * En qué punto del surtido va el pedido.
 *
 * Se deriva de hechos, no de un campo de estado. Un estado guardado en el
 * pedido habría que mantenerlo al día desde cuatro sitios distintos —crear
 * requisición, convertir, cancelar, recibir— y el primero que se olvide deja la
 * lista mintiendo. Es el mismo criterio del saldo en cuentas por pagar.
 */
function Surtido({ pedido }: { pedido: SalesOrderRow }) {
  if (pedido.lineas === 0) {
    return (
      <Badge className="bg-secondary text-muted-foreground ring-border">
        Sin productos
      </Badge>
    );
  }
  if (pedido.requisiciones === 0) {
    return (
      <Badge className="bg-secondary text-muted-foreground ring-border">
        Sin requisitar
      </Badge>
    );
  }
  if (pedido.porComprar > 0) {
    return (
      <Badge className="bg-warning/10 text-warning ring-warning/25">
        En compras
      </Badge>
    );
  }
  return (
    <Badge className="bg-success/10 text-success ring-success/25">Comprado</Badge>
  );
}

function money(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function fecha(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}
