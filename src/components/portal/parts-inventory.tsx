"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, PackageX, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditPartRow, type EditablePart } from "@/components/portal/part-forms";
import { cn } from "@/lib/utils";

type Row = EditablePart & { brand: string | null };

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

type StockFilter = "all" | "low" | "out";

export function PartsInventory({ parts }: { parts: Row[] }) {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("all");
  const [stock, setStock] = useState<StockFilter>("all");

  const brands = useMemo(
    () => Array.from(new Set(parts.map((p) => p.brand).filter(Boolean))).sort(),
    [parts],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return parts.filter((p) => {
      if (brand !== "all" && p.brand !== brand) return false;
      if (stock === "low" && !(p.stock > 0 && p.stock <= 3)) return false;
      if (stock === "out" && p.stock !== 0) return false;
      if (!term) return true;
      return `${p.partNumber} ${p.description} ${p.brand ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [parts, q, brand, stock]);

  const lowCount = parts.filter((p) => p.stock > 0 && p.stock <= 3).length;
  const outCount = parts.filter((p) => p.stock === 0).length;
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
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando <span className="font-medium text-foreground">{filtered.length}</span> de{" "}
          {parts.length} · valor en existencia{" "}
          <span className="font-medium text-foreground">
            {mxn(String(value))}
          </span>
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
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium"># Parte</th>
                  <th className="px-4 py-3 font-medium">Descripción</th>
                  <th className="px-4 py-3 font-medium">Marca</th>
                  <th className="px-4 py-3 font-medium">Costo actual (MXN)</th>
                  <th className="px-4 py-3 font-medium">Precio venta</th>
                  <th className="px-4 py-3 font-medium">Margen</th>
                  <th className="px-4 py-3 font-medium">Existencias</th>
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
                          p.stock === 0
                            ? "font-semibold text-destructive"
                            : p.stock <= 3
                              ? "font-semibold text-warning"
                              : ""
                        }
                      >
                        {p.stock}
                      </span>
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
