"use client";

import { useMemo, useState } from "react";
import { Building2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { money } from "@/lib/crm";
import { cn } from "@/lib/utils";

export type OrganizationRow = {
  id: string;
  name: string;
  taxId: string | null;
  industry: string | null;
  address: string | null;
  phone: string | null;
  ownerName: string | null;
  /** Tiene cuenta de portal enlazada (es cliente activo, no solo prospecto). */
  isClient: boolean;
  contacts: number;
  openDeals: number;
  openValue: number;
};

type Filter = "all" | "clients" | "deals" | "unassigned";

/**
 * Listado de organizaciones con búsqueda.
 *
 * El filtrado es en cliente y no en el servidor a propósito: son ~160 filas
 * que ya vienen cargadas para pintar las tarjetas, así que buscar en memoria
 * es instantáneo y no cuesta un viaje al servidor por tecla. Si el padrón
 * crece a miles, esto pasa a ser una consulta con índice sobre `name`/`tax_id`.
 */
export function OrganizationsList({
  orgs,
  locale,
}: {
  orgs: OrganizationRow[];
  locale: string;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    // Sin acentos y en minúsculas: "farmacéutica" debe encontrarse escribiendo
    // "farmaceutica", que es como se teclea con prisa.
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const term = norm(q.trim());

    return orgs.filter((o) => {
      if (filter === "clients" && !o.isClient) return false;
      if (filter === "deals" && o.openDeals === 0) return false;
      if (filter === "unassigned" && o.ownerName) return false;
      if (!term) return true;
      // Se busca también por RFC: es como los identifica el área de facturación.
      return norm(
        [o.name, o.taxId, o.industry, o.address, o.phone].filter(Boolean).join(" "),
      ).includes(term);
    });
  }, [orgs, q, filter]);

  const clientCount = orgs.filter((o) => o.isClient).length;
  const dealCount = orgs.filter((o) => o.openDeals > 0).length;
  const unassignedCount = orgs.filter((o) => !o.ownerName).length;

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, RFC, giro, dirección o teléfono…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Buscar organizaciones"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setFilter("all")} className={chip(filter === "all")}>
            Todas ({orgs.length})
          </button>
          <button
            onClick={() => setFilter("clients")}
            className={chip(filter === "clients")}
          >
            Con portal ({clientCount})
          </button>
          <button onClick={() => setFilter("deals")} className={chip(filter === "deals")}>
            Con negocios ({dealCount})
          </button>
          {unassignedCount > 0 && (
            <button
              onClick={() => setFilter("unassigned")}
              className={chip(filter === "unassigned")}
            >
              Sin responsable ({unassignedCount})
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando{" "}
          <span className="font-medium text-foreground">{filtered.length}</span> de{" "}
          {orgs.length} organización(es)
        </p>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Building2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {q
              ? `Ninguna organización coincide con «${q}».`
              : "No hay organizaciones con este filtro."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((o) => (
            <Card
              key={o.id}
              className="p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/crm/organizaciones/${o.id}`}
                    className="font-medium hover:text-primary"
                  >
                    {o.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[o.industry, o.taxId].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {o.isClient && (
                  <Badge className="shrink-0 bg-success/15 text-success ring-success/25">
                    Cliente
                  </Badge>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>{o.contacts} contacto(s)</span>
                <span>{o.openDeals} negocio(s) abierto(s)</span>
                <span className="font-mono">
                  {money(String(o.openValue), "MXN", locale)}
                </span>
              </div>

              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                Responsable: {o.ownerName ?? "Sin asignar"}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
