"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Package, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PartOption = {
  id: string;
  partNumber: string;
  description: string;
  brand?: string | null;
  costMxn: string | null;
  stock: number;
};

export type PickedPart = { id: string; qty: number };

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);

/**
 * Selector de refacciones con búsqueda incremental.
 * Filtra por número de parte, descripción o marca; permite ajustar cantidad
 * y muestra el subtotal. Emite inputs ocultos partIds/partQtys para el form.
 */
export function PartsPicker({
  parts,
  value,
  onChange,
}: {
  parts: PartOption[];
  value: PickedPart[];
  onChange: (next: PickedPart[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Cierra al hacer clic fuera.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const chosen = useMemo(() => new Set(value.map((v) => v.id)), [value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = parts.filter((p) => !chosen.has(p.id));
    if (!q) return base.slice(0, 8);
    return base
      .filter((p) =>
        `${p.partNumber} ${p.description} ${p.brand ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [parts, query, chosen]);

  useEffect(() => setHighlight(0), [query, open]);

  function add(p: PartOption) {
    onChange([...value, { id: p.id, qty: 1 }]);
    setQuery("");
    setOpen(false);
  }

  function setQty(id: string, qty: number) {
    onChange(value.map((v) => (v.id === id ? { ...v, qty: Math.max(1, qty) } : v)));
  }

  const subtotal = value.reduce((a, v) => {
    const p = parts.find((x) => x.id === v.id);
    return a + Number(p?.costMxn ?? 0) * v.qty;
  }, 0);

  return (
    <div className="space-y-2">
      {/* Seleccionadas */}
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((v) => {
            const p = parts.find((x) => x.id === v.id);
            if (!p) return null;
            const over = v.qty > p.stock;
            return (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
              >
                <input type="hidden" name="partIds" value={v.id} />
                <input type="hidden" name="partQtys" value={v.qty} />
                <Package className="size-3.5 shrink-0 text-primary" />
                <span className="font-mono text-xs font-semibold">{p.partNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {p.description}
                </span>

                {/* Cantidad */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setQty(v.id, v.qty - 1)}
                    className="flex size-6 items-center justify-center rounded border border-border hover:bg-secondary"
                    aria-label="Menos"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="w-7 text-center text-sm font-medium">{v.qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(v.id, v.qty + 1)}
                    className="flex size-6 items-center justify-center rounded border border-border hover:bg-secondary"
                    aria-label="Más"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>

                <span className="w-24 text-right text-sm font-medium">
                  {p.costMxn ? mxn(Number(p.costMxn) * v.qty) : "—"}
                </span>

                {over && (
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                    excede stock ({p.stock})
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Quitar"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
          <li className="flex justify-end gap-3 px-1 text-sm">
            <span className="text-muted-foreground">Subtotal refacciones</span>
            <span className="font-semibold">{mxn(subtotal)}</span>
          </li>
        </ul>
      )}

      {/* Buscador */}
      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[highlight]) add(results[highlight]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Buscar refacción por # parte, descripción o marca…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Limpiar"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
            {results.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                {query ? "Sin coincidencias." : "No hay refacciones disponibles."}
              </p>
            ) : (
              <ul>
                {results.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => add(p)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        i === highlight ? "bg-secondary" : "hover:bg-secondary/60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {p.partNumber}
                          </span>
                          {p.brand && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {p.brand}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {p.description}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium">
                          {p.costMxn ? mxn(Number(p.costMxn)) : "—"}
                        </div>
                        <div
                          className={cn(
                            "text-[11px]",
                            p.stock === 0
                              ? "text-destructive"
                              : p.stock <= 3
                                ? "text-warning"
                                : "text-muted-foreground",
                          )}
                        >
                          {p.stock === 0 ? "sin stock" : `${p.stock} en stock`}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
