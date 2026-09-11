import { AlertTriangle, PackageCheck, PackageX, Search, Truck, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";
import { FormularioGet } from "@/components/portal/formulario-get";
import { ThOrden } from "@/components/portal/listado-controles";
import { EditPartRow, type EditablePart } from "@/components/portal/part-forms";
import type { CampoRefaccion, FiltroExistencia } from "@/lib/data/parts";
import type { Orden } from "@/lib/listado";
import { cn } from "@/lib/utils";

/**
 * EL INVENTARIO SE FILTRA, ORDENA Y PAGINA EN EL SERVIDOR.
 *
 * Era un componente de cliente que recibía el catálogo entero y hacía todo en el
 * navegador. Con una refacción daba igual; con las 6 609 del ERP anterior la
 * página pesaba 10 MB. Ahora llega una página, y el buscador, los chips y las
 * columnas son ENLACES: el estado vive en la URL, que además se puede compartir
 * y sobrevive a recargar. Es el mismo arreglo que se le hizo a Clientes.
 */

/** Lo pendiente de recibir de esta refacción, de `incomingByPart`. */
export type Incoming = { quantity: number; expectedAt: string | null };

type Row = EditablePart & { incoming: Incoming | null };

const mxn = (v: string | number | null) => {
  if (v === null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
};

/** Fecha corta: la orden guarda `date`, sin hora ni zona que interpretar. */
const fecha = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
};

export type ResumenInventario = {
  total: number;
  con: number;
  low: number;
  out: number;
  incoming: number;
  sobregiros: Array<{ id: string; partNumber: string; stock: number; incoming: Incoming | null }>;
  marcas: string[];
};

export function PartsInventory({
  parts,
  resumen,
  filtradas,
  valor,
  q,
  marca,
  existencia,
  orden,
  basePath,
}: {
  parts: Row[];
  resumen: ResumenInventario;
  /** Cuántas caen en el filtro, en todas las páginas. */
  filtradas: number;
  /** Valor en existencia de lo filtrado. */
  valor: number;
  q: string;
  marca?: string;
  existencia?: FiltroExistencia;
  orden: Orden<CampoRefaccion>;
  basePath: string;
}) {
  // Lo que se conserva al pulsar cualquier cosa. La página NO: cambiar el filtro
  // desde la página 40 dejaría una página que ya no existe.
  const consulta: Record<string, string | undefined> = {
    q: q || undefined,
    marca,
    existencia,
    orden: orden.campo,
    dir: orden.dir,
  };
  const enlace = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...consulta, ...cambios })) if (v) p.set(k, v);
    const cola = p.toString();
    return cola ? `${basePath}?${cola}` : basePath;
  };
  // Para las columnas: todo menos el orden, que lo pone cada una.
  const queryOrden = { q: q || undefined, marca, existencia };

  const { sobregiros } = resumen;
  // Lo que de verdad hay que comprar: el SOBREGIRO que no viene en camino.
  //
  // Contaba también las que están en cero, y con el catálogo del ERP anterior
  // eso decía «6 190 sin cubrir»: refacciones que nunca se tuvieron en almacén
  // no faltan. Un sobregiro sí —se consumió lo que no había—.
  const descubiertas = sobregiros.filter(
    (p) => !p.incoming || p.incoming.quantity < Math.abs(p.stock),
  );
  const shortfall = sobregiros.reduce((a, p) => a + Math.abs(p.stock), 0);

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground",
    );
  const nf = new Intl.NumberFormat("es-MX");

  return (
    <div className="space-y-4">
      {/* Sobregiro: se usó más de lo que había en existencia. El consumo se
          registró tal cual (refleja la realidad física) y el faltante queda
          aquí visible para compras, en vez de silenciarse topando el stock. */}
      {sobregiros.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">
                {sobregiros.length === 1
                  ? "1 refacción con existencia negativa"
                  : `${sobregiros.length} refacciones con existencia negativa`}{" "}
                · faltan {shortfall} {shortfall === 1 ? "pieza" : "piezas"}
              </p>
              <p className="text-xs text-muted-foreground">
                Se consumió más de lo registrado en inventario. Hay que reponer o
                corregir el conteo físico:
              </p>
              {/* Cuáles ya están pedidas y cuáles no. Antes la lista era una
                  sola y mandaba a comprar de nuevo algo que ya venía en camino. */}
              <ul className="space-y-0.5 text-xs">
                {sobregiros.map((p) => {
                  const cubre = p.incoming && p.incoming.quantity >= Math.abs(p.stock);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-medium text-foreground">
                        {p.partNumber}
                      </span>
                      <span className="text-destructive">({p.stock})</span>
                      {p.incoming ? (
                        <span className={cubre ? "text-success" : "text-warning"}>
                          <Truck className="mr-1 inline size-3" />
                          {cubre ? "cubierto" : "insuficiente"}: llegan{" "}
                          {p.incoming.quantity}
                          {p.incoming.expectedAt
                            ? ` el ${fecha(p.incoming.expectedAt)}`
                            : ", sin fecha"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sin orden de compra</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Buscador y filtros */}
      <Card className="p-4">
        {/* A la URL como el resto, y por `FormularioGet` para no perder el
            prefijo de la empresa. Los filtros puestos viajan en ocultos para
            no perderlos al buscar. */}
        <FormularioGet
          action={basePath}
          className="flex items-center gap-2 rounded-lg border border-input bg-background px-3"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          {marca && <input type="hidden" name="marca" value={marca} />}
          {existencia && <input type="hidden" name="existencia" value={existencia} />}
          <input type="hidden" name="orden" value={orden.campo} />
          <input type="hidden" name="dir" value={orden.dir} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por # parte, descripción o marca…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <Link
              href={enlace({ q: undefined })}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Limpiar"
            >
              <X className="size-4" />
            </Link>
          )}
        </FormularioGet>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {resumen.marcas.length > 0 && (
            <>
              <Link href={enlace({ marca: undefined })} className={chip(!marca)}>
                Todas las marcas
              </Link>
              {resumen.marcas.map((b) => (
                <Link key={b} href={enlace({ marca: b })} className={chip(marca === b)}>
                  {b}
                </Link>
              ))}
              <span className="mx-1 h-5 w-px bg-border" />
            </>
          )}

          <Link href={enlace({ existencia: undefined })} className={chip(!existencia)}>
            Todo el catálogo ({nf.format(resumen.total)})
          </Link>
          {/* El inventario físico. Ver `FILTROS_EXISTENCIA`. */}
          <Link href={enlace({ existencia: "con" })} className={chip(existencia === "con")}>
            <PackageCheck className="mr-1 inline size-3" />
            Con existencia ({nf.format(resumen.con)})
          </Link>
          <Link href={enlace({ existencia: "low" })} className={chip(existencia === "low")}>
            <AlertTriangle className="mr-1 inline size-3" />
            Bajo ({nf.format(resumen.low)})
          </Link>
          <Link href={enlace({ existencia: "out" })} className={chip(existencia === "out")}>
            <PackageX className="mr-1 inline size-3" />
            Agotado ({nf.format(resumen.out)})
          </Link>
          {resumen.incoming > 0 && (
            <Link
              href={enlace({ existencia: "incoming" })}
              className={cn(
                chip(existencia === "incoming"),
                existencia !== "incoming" && "bg-primary/10 text-primary",
              )}
            >
              <Truck className="mr-1 inline size-3" />
              En camino ({resumen.incoming})
            </Link>
          )}
          {sobregiros.length > 0 && (
            <Link
              href={enlace({ existencia: "over" })}
              className={cn(
                chip(existencia === "over"),
                existencia !== "over" && "bg-destructive/10 text-destructive",
              )}
            >
              <AlertTriangle className="mr-1 inline size-3" />
              Sobregiro ({sobregiros.length})
            </Link>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{nf.format(filtradas)}</span>{" "}
          {filtradas === 1 ? "refacción" : "refacciones"}
          {filtradas !== resumen.total && <> de {nf.format(resumen.total)}</>} · valor en
          existencia <span className="font-medium text-foreground">{mxn(valor)}</span>
          {descubiertas.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-warning">
                {descubiertas.length} sin cubrir
              </span>{" "}
              (en sobregiro y no viene en camino)
            </>
          )}
        </p>
      </Card>

      {/* Resultados */}
      <Card className="overflow-hidden">
        {parts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Search className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {q ? `Sin coincidencias para «${q}».` : "Ninguna refacción cumple ese filtro."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table data-tabla="refacciones" className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <ThOrden campo="parte" actual={orden} basePath={basePath} query={queryOrden}>
                    # Parte
                  </ThOrden>
                  <ThOrden campo="descripcion" actual={orden} basePath={basePath} query={queryOrden}>
                    Descripción
                  </ThOrden>
                  <ThOrden campo="marca" actual={orden} basePath={basePath} query={queryOrden}>
                    Marca
                  </ThOrden>
                  <ThOrden campo="costo" actual={orden} basePath={basePath} query={queryOrden} inicial="desc">
                    Costo actual (MXN)
                  </ThOrden>
                  <ThOrden campo="precio" actual={orden} basePath={basePath} query={queryOrden} inicial="desc">
                    Precio venta
                  </ThOrden>
                  <ThOrden campo="margen" actual={orden} basePath={basePath} query={queryOrden}>
                    Margen
                  </ThOrden>
                  <ThOrden campo="existencias" actual={orden} basePath={basePath} query={queryOrden} inicial="desc">
                    Existencias
                  </ThOrden>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parts.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-secondary/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold">
                      {p.partNumber}
                    </td>
                    <td className="max-w-sm px-4 py-3">{p.description}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {p.brand ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {mxn(p.costMxn)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-success">
                      {mxn(p.priceMxn)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {p.costMxn && p.priceMxn && Number(p.priceMxn) > 0
                        ? `${(((Number(p.priceMxn) - Number(p.costMxn)) / Number(p.priceMxn)) * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          p.stock < 0
                            ? "rounded bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive"
                            : p.stock === 0
                              ? "text-muted-foreground"
                              : p.stock <= 3
                                ? "font-semibold text-warning"
                                : ""
                        }
                        title={
                          p.stock < 0 ? `Sobregiro: faltan ${Math.abs(p.stock)} piezas` : undefined
                        }
                      >
                        {p.stock}
                      </span>
                      {/* Lo que viene en camino va pegado a la existencia y no
                          en su propia columna: es la misma pregunta —¿me
                          alcanza?— y separarlas obligaba a mirar dos lugares
                          para contestarla. */}
                      {p.incoming && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary"
                          title={
                            p.incoming.expectedAt
                              ? `Llegan ${p.incoming.quantity} el ${p.incoming.expectedAt}`
                              : `Llegan ${p.incoming.quantity}, sin fecha comprometida`
                          }
                        >
                          <Truck className="size-3" />+{p.incoming.quantity}
                          {p.incoming.expectedAt && (
                            <span className="text-muted-foreground">
                              {fecha(p.incoming.expectedAt)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          p.active
                            ? "bg-success/15 text-success ring-success/25"
                            : "bg-muted text-muted-foreground ring-border"
                        }
                      >
                        {p.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <EditPartRow part={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
