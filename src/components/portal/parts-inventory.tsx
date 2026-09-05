"use client";

import { useMemo, useState } from "react";
import { ThLocal, useOrdenLocal } from "@/components/portal/orden-local";
import { AlertTriangle, PackageX, Search, Truck, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditPartRow, type EditablePart } from "@/components/portal/part-forms";
import { cn } from "@/lib/utils";

/** Lo pendiente de recibir de esta refacción, de `incomingByPart`. */
export type Incoming = { quantity: number; expectedAt: string | null };

type Row = EditablePart & { brand: string | null; incoming: Incoming | null };

const mxn = (v: string | null) => {
  if (!v) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
};
const usd = (v: string | null) => {
  if (!v) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
};

// "over" = sobregiro: se consumió más de lo que había. Antes era imposible de
// ver porque el descuento se topaba en 0 y el faltante se perdía.
/** Fecha corta: la orden guarda `date`, sin hora ni zona que interpretar. */
const fecha = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
};

type StockFilter = "all" | "low" | "out" | "over" | "incoming";

/**
 * Qué significa ordenar por cada columna del inventario.
 *
 * `margen` se calcula aquí y no se lee de una columna: es precio menos costo, y
 * ordenar por él es la forma de encontrar lo que se está vendiendo por debajo
 * de lo que cuesta. Una refacción sin precio o sin costo capturado no tiene
 * margen que comparar —no es margen cero— y va al final.
 */
const num = (v: string | null) => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const VALORES_PARTE = {
  parte: (p: Row) => p.partNumber,
  descripcion: (p: Row) => p.description,
  marca: (p: Row) => p.brand,
  costo: (p: Row) => num(p.costMxn),
  precio: (p: Row) => num(p.priceMxn),
  margen: (p: Row) => {
    const c = num(p.costMxn);
    const v = num(p.priceMxn);
    return c === null || v === null ? null : v - c;
  },
  existencias: (p: Row) => p.stock,
} as const;

type CampoParte = keyof typeof VALORES_PARTE;

export function PartsInventory({ parts }: { parts: Row[] }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("all");
  const [stock, setStock] = useState<StockFilter>("all");

  const brands = useMemo(
    () => Array.from(new Set(parts.map((p) => p.brand).filter(Boolean))).sort(),
    [parts],
  );

  const filtradas = useMemo(() => {
    const term = q.trim().toLowerCase();
    return parts.filter((p) => {
      if (brand !== "all" && p.brand !== brand) return false;
      if (stock === "low" && !(p.stock > 0 && p.stock <= 3)) return false;
      if (stock === "out" && p.stock !== 0) return false;
      if (stock === "over" && p.stock >= 0) return false;
      if (stock === "incoming" && !p.incoming) return false;
      if (!term) return true;
      return `${p.partNumber} ${p.description} ${p.brand ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [parts, q, brand, stock]);

  /*
    Arranca por EXISTENCIAS de menor a mayor, y es el único de los tres
    listados en memoria que no arranca alfabético.

    Un inventario no se abre para buscar una refacción concreta —para eso está
    el buscador de arriba— sino para ver qué falta. Con el orden por número de
    parte, lo que está en cero queda repartido por toda la lista y hay que
    filtrar para verlo; ordenado así, el problema está en la primera fila.
    Los sobregiros, que son negativos, quedan incluso antes: correcto, porque
    son peores que un cero.
  */
  const { orden, pulsar, ordenadas: filtered } = useOrdenLocal<Row, CampoParte>(
    filtradas,
    VALORES_PARTE,
    { campo: "existencias", dir: "asc" },
  );

  const lowCount = parts.filter((p) => p.stock > 0 && p.stock <= 3).length;
  const outCount = parts.filter((p) => p.stock === 0).length;
  const overParts = parts.filter((p) => p.stock < 0);
  const incomingParts = parts.filter((p) => p.incoming);

  // Lo que de verdad hay que comprar: falta y NO viene en camino. Sin esta
  // distinción, una refacción ya pedida sigue apareciendo como pendiente y se
  // vuelve a comprar — que es exactamente el error que este cruce evita.
  const descubiertas = parts.filter(
    (p) => p.stock <= 0 && (!p.incoming || p.incoming.quantity < Math.abs(p.stock)),
  );
  // Piezas que hay que reponer para volver a cero: es el faltante real.
  const shortfall = overParts.reduce((a, p) => a + Math.abs(p.stock), 0);
  const value = filtered.reduce(
    (a, p) => a + Number(p.costMxn ?? 0) * p.stock,
    0,
  );

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      {/* Sobregiro: se usó más de lo que había en existencia. El consumo se
          registró tal cual (refleja la realidad física) y el faltante queda
          aquí visible para compras, en vez de silenciarse topando el stock. */}
      {overParts.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">
                {overParts.length === 1
                  ? "1 refacción con existencia negativa"
                  : `${overParts.length} refacciones con existencia negativa`}{" "}
                · faltan {shortfall} {shortfall === 1 ? "pieza" : "piezas"}
              </p>
              <p className="text-xs text-muted-foreground">
                Se consumió más de lo registrado en inventario. Hay que reponer o
                corregir el conteo físico:
              </p>
              {/* Cuáles ya están pedidas y cuáles no. Antes la lista era una
                  sola y mandaba a comprar de nuevo algo que ya venía en camino. */}
              <ul className="space-y-0.5 text-xs">
                {overParts.map((p) => {
                  const cubre =
                    p.incoming && p.incoming.quantity >= Math.abs(p.stock);
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
        <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por # parte, descripción o marca…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Limpiar"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setBrand("all")} className={chip(brand === "all")}>
            Todas las marcas
          </button>
          {brands.map((b) => (
            <button key={b} onClick={() => setBrand(b!)} className={chip(brand === b)}>
              {b}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-border" />

          <button onClick={() => setStock("all")} className={chip(stock === "all")}>
            Todo el stock
          </button>
          <button onClick={() => setStock("low")} className={chip(stock === "low")}>
            <AlertTriangle className="mr-1 inline size-3" />
            Bajo ({lowCount})
          </button>
          <button onClick={() => setStock("out")} className={chip(stock === "out")}>
            <PackageX className="mr-1 inline size-3" />
            Agotado ({outCount})
          </button>
          {incomingParts.length > 0 && (
            <button
              onClick={() => setStock("incoming")}
              className={cn(
                chip(stock === "incoming"),
                stock !== "incoming" && "bg-primary/10 text-primary",
              )}
            >
              <Truck className="mr-1 inline size-3" />
              En camino ({incomingParts.length})
            </button>
          )}
          {overParts.length > 0 && (
            <button
              onClick={() => setStock("over")}
              className={cn(
                chip(stock === "over"),
                stock !== "over" && "bg-destructive/10 text-destructive",
              )}
            >
              <AlertTriangle className="mr-1 inline size-3" />
              Sobregiro ({overParts.length})
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando <span className="font-medium text-foreground">{filtered.length}</span> de{" "}
          {parts.length} · valor en existencia{" "}
          <span className="font-medium text-foreground">
            {mxn(String(value))}
          </span>
          {descubiertas.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-warning">
                {descubiertas.length}{" "}
                {descubiertas.length === 1 ? "sin cubrir" : "sin cubrir"}
              </span>{" "}
              (falta y no viene en camino)
            </>
          )}
        </p>
      </Card>

      {/* Resultados */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Search className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sin coincidencias para “{q}”.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <ThLocal campo="parte" orden={orden} onPulsar={pulsar}>
                    # Parte
                  </ThLocal>
                  <ThLocal campo="descripcion" orden={orden} onPulsar={pulsar}>
                    Descripción
                  </ThLocal>
                  <ThLocal campo="marca" orden={orden} onPulsar={pulsar}>
                    Marca
                  </ThLocal>
                  <ThLocal campo="costo" orden={orden} onPulsar={pulsar} inicial="desc">
                    Costo actual (MXN)
                  </ThLocal>
                  <ThLocal campo="precio" orden={orden} onPulsar={pulsar} inicial="desc">
                    Precio venta
                  </ThLocal>
                  <ThLocal campo="margen" orden={orden} onPulsar={pulsar} inicial="asc">
                    Margen
                  </ThLocal>
                  <ThLocal campo="existencias" orden={orden} onPulsar={pulsar} inicial="asc">
                    Existencias
                  </ThLocal>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => (
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
                              ? "font-semibold text-destructive"
                              : p.stock <= 3
                                ? "font-semibold text-warning"
                                : ""
                        }
                        title={
                          p.stock < 0
                            ? `Sobregiro: faltan ${Math.abs(p.stock)} piezas`
                            : undefined
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
