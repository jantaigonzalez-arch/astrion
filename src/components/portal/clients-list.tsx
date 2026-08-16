"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Building2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";
import { money } from "@/lib/crm";
import { cn } from "@/lib/utils";

/**
 * Listado de clientes: quien ya compró, visto desde el SERVICIO.
 *
 * Es deliberadamente distinto del listado de leads, aunque detrás sea la misma
 * tabla. De un lead importa el potencial —negocios abiertos, valor, quién lo
 * lleva—; de un cliente importa lo que ya existe y hay que atender: contratos
 * vigentes, equipos instalados, tickets abiertos y cuándo fue la última vez que
 * se le tocó. Enseñar las mismas columnas en las dos pantallas sería tratar dos
 * trabajos distintos como si fueran el mismo.
 *
 * Va en tabla y no en tarjetas, al revés que los leads: aquí casi todo son
 * números y las tablas se comparan de un vistazo. Son 24 filas; el día que sean
 * cientos, esto se pagina igual que la cola de tickets.
 */

export type ClientListRow = {
  id: string;
  name: string;
  taxId: string | null;
  industry: string | null;
  ownerName: string | null;
  /** Tiene cuenta de portal enlazada: sin ella no hay equipos ni tickets que encontrar. */
  hasPortal: boolean;
  contracts: number;
  equipment: number;
  openTickets: number;
  totalTickets: number;
  lastTicketAt: string | null;
  wonDeals: number;
  wonValue: number;
};

type Filter = "all" | "conAbiertos" | "sinPortal";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function ClientsList({
  clients,
  locale,
}: {
  clients: ClientListRow[];
  locale: string;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const term = norm(q.trim());
    return clients.filter((c) => {
      if (filter === "conAbiertos" && c.openTickets === 0) return false;
      if (filter === "sinPortal" && c.hasPortal) return false;
      if (!term) return true;
      return norm([c.name, c.taxId, c.industry].filter(Boolean).join(" ")).includes(
        term,
      );
    });
  }, [clients, q, filter]);

  const conAbiertos = clients.filter((c) => c.openTickets > 0).length;
  const sinPortal = clients.filter((c) => !c.hasPortal).length;

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground",
    );

  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, RFC o giro…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Buscar cliente"
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
            Todos ({clients.length})
          </button>
          <button
            onClick={() => setFilter("conAbiertos")}
            className={chip(filter === "conAbiertos")}
          >
            Con tickets abiertos ({conAbiertos})
          </button>
          {sinPortal > 0 && (
            <button
              onClick={() => setFilter("sinPortal")}
              className={chip(filter === "sinPortal")}
            >
              Sin cuenta de portal ({sinPortal})
            </button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Building2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {q
              ? `Ningún cliente coincide con «${q}».`
              : "No hay clientes con este filtro."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Contratos</th>
                  <th className="px-4 py-3 font-medium">Equipos</th>
                  <th className="px-4 py-3 font-medium">Tickets</th>
                  <th className="px-4 py-3 font-medium">Último servicio</th>
                  <th className="px-4 py-3 text-right font-medium">Comprado</th>
                  <th className="px-4 py-3 font-medium">Responsable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/crm/organizaciones/${c.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[c.industry, c.taxId].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {/*
                        Sin cuenta de portal no hay forma de encontrarle equipos
                        ni tickets: cuelgan de esa cuenta, no de la organización.
                        Los ceros de esta fila no significan «no tiene», sino
                        «no hay por dónde buscarlo», y decirlo evita que alguien
                        concluya que un cliente con equipo instalado no lo tiene.
                      */}
                      {!c.hasPortal && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                          <AlertTriangle className="size-3" />
                          Sin cuenta de portal — enlázala para ver sus equipos y
                          tickets
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.hasPortal ? c.contracts : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.hasPortal ? c.equipment : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.hasPortal ? (
                        <>
                          {c.openTickets > 0 && (
                            <Badge className="mr-1 bg-warning/15 text-warning ring-warning/25">
                              {c.openTickets} abierto(s)
                            </Badge>
                          )}
                          <span className="text-muted-foreground">
                            {c.totalTickets} total
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {c.hasPortal ? fecha(c.lastTicketAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.wonDeals > 0 ? (
                        <>
                          {money(String(c.wonValue), "MXN", locale)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({c.wonDeals})
                          </span>
                        </>
                      ) : (
                        // Cliente heredado del sistema anterior: su compra no pasó
                        // por el embudo, así que no hay negocio ganado que sumar.
                        <span className="text-muted-foreground">histórico</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.ownerName ?? "Sin asignar"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            {filtered.length} de {clients.length} cliente(s)
          </p>
        </Card>
      )}
    </div>
  );
}
