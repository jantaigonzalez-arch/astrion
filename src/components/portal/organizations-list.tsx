"use client";

import { useMemo, useState } from "react";
import { ThLocal, useOrdenLocal } from "@/components/portal/orden-local";
import { Building2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";
import { Telefono } from "@/components/portal/telefono";
import {
  ORG_KIND_LABELS,
  ORG_KIND_STYLES,
  label,
  money,
  type OrgKind,
} from "@/lib/crm";
import { claimOrganization } from "@/lib/actions/crm";
import { cn } from "@/lib/utils";

export type OrganizationRow = {
  id: string;
  name: string;
  taxId: string | null;
  industry: string | null;
  address: string | null;
  phone: string | null;
  ownerName: string | null;
  /**
   * Si ya compró (`client`) o sigue siendo prospecto (`lead`). La regla vive en
   * `ES_CLIENTE`, en la capa de datos, y es la misma que agrupa el selector del
   * formulario de negocio.
   */
  kind: OrgKind;
  /**
   * Tiene cuenta de portal enlazada.
   *
   * Ya NO es lo mismo que «es cliente», aunque antes este campo se llamaba
   * `isClient` y se pintaba como tal. Son dos hechos distintos: una empresa
   * puede haberte comprado sin que nadie de su equipo entre nunca al portal.
   */
  hasPortal: boolean;
  contacts: number;
  openDeals: number;
  openValue: number;
};

type Filter = "all" | "clients" | "leads" | "deals" | "unassigned";

/**
 * Listado de organizaciones con búsqueda.
 *
 * El filtrado es en cliente y no en el servidor a propósito: son ~160 filas
 * que ya vienen cargadas para pintar las tarjetas, así que buscar en memoria
 * es instantáneo y no cuesta un viaje al servidor por tecla. Si el padrón
 * crece a miles, esto pasa a ser una consulta con índice sobre `name`/`tax_id`.
 */
/**
 * Qué significa ordenar por cada ficha.
 *
 * `abierto` es el importe de los negocios abiertos y `negocios` su número:
 * ordenar por dinero y por cantidad no da la misma lista, y en una cartera con
 * una oportunidad grande y veinte pequeñas esa diferencia es la decisión de a
 * quién llamar hoy.
 */
const VALORES_ORG = {
  nombre: (o: OrganizationRow) => o.name,
  // Los clientes primero al ordenar descendente: «client» < «lead» alfabéticamente,
  // así que se invierte a mano. Quien pulsa esta columna busca separar las dos
  // carteras, y la mitad que interesa mirar primero es la que ya compra.
  tipo: (o: OrganizationRow) => (o.kind === "client" ? 1 : 0),
  abierto: (o: OrganizationRow) => (o.openDeals > 0 ? o.openValue : null),
  negocios: (o: OrganizationRow) => (o.openDeals > 0 ? o.openDeals : null),
  contactos: (o: OrganizationRow) => (o.contacts > 0 ? o.contacts : null),
  responsable: (o: OrganizationRow) => o.ownerName,
} as const;

type CampoOrg = keyof typeof VALORES_ORG;

export function OrganizationsList({
  orgs,
  locale,
}: {
  orgs: OrganizationRow[];
  locale: string;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtrados = useMemo(() => {
    // Sin acentos y en minúsculas: "farmacéutica" debe encontrarse escribiendo
    // "farmaceutica", que es como se teclea con prisa.
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const term = norm(q.trim());

    return orgs.filter((o) => {
      if (filter === "clients" && o.kind !== "client") return false;
      if (filter === "leads" && o.kind !== "lead") return false;
      if (filter === "deals" && o.openDeals === 0) return false;
      if (filter === "unassigned" && o.ownerName) return false;
      if (!term) return true;
      // Se busca también por RFC: es como los identifica el área de facturación.
      return norm(
        [o.name, o.taxId, o.industry, o.address, o.phone].filter(Boolean).join(" "),
      ).includes(term);
    });
  }, [orgs, q, filter]);

  // Alfabético de arranque: este listado se usa para BUSCAR una organización.
  // Quien viene a ver dónde está el dinero abierto pulsa «Abierto».
  const { orden, pulsar, ordenadas: filtered } = useOrdenLocal<
    OrganizationRow,
    CampoOrg
  >(filtrados, VALORES_ORG, { campo: "nombre", dir: "asc" });

  const clientCount = orgs.filter((o) => o.kind === "client").length;
  const leadCount = orgs.filter((o) => o.kind === "lead").length;
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
          {/*
            Los filtros de tipo solo aparecen cuando hay de los dos.

            Esta lista sirve al catálogo completo y también a la pantalla de
            Prospectos, donde todas las filas lo son: ahí un botón «Clientes (0)»
            no filtra nada y solo invita a pulsarlo para no obtener resultados.
          */}
          {clientCount > 0 && leadCount > 0 && (
            <>
              <button
                onClick={() => setFilter("clients")}
                className={chip(filter === "clients")}
              >
                Clientes ({clientCount})
              </button>
              <button
                onClick={() => setFilter("leads")}
                className={chip(filter === "leads")}
              >
                Prospectos ({leadCount})
              </button>
            </>
          )}
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
        /*
          TABLA, NO TARJETAS. Y por lo mismo que la de Clientes.

          Eran tarjetas de dos columnas, y con eso esta pantalla se leía distinto
          de todas las demás del sistema: no ordenaba por cabecera, no se podía
          estrechar una columna, la densidad no la afectaba. La cartera de
          prospectos y la de clientes son la MISMA cartera en dos momentos —un
          prospecto termina convertido en cliente—, así que mirarlas no puede
          exigir dos costumbres distintas.

          Y en tarjetas no cabía lo que sí importa: teléfono y contactos vivían
          solo en el catálogo de organizaciones, que no está en el menú.
        */
        <Card className="overflow-hidden">
          <div className="tabla-caja overflow-x-auto">
            <table data-tabla="organizaciones" className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <ThLocal campo="nombre" orden={orden} onPulsar={pulsar}>
                    Organización
                  </ThLocal>
                  <ThLocal campo="tipo" orden={orden} onPulsar={pulsar}>
                    Tipo
                  </ThLocal>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <ThLocal campo="contactos" orden={orden} onPulsar={pulsar} inicial="desc">
                    Contactos
                  </ThLocal>
                  <ThLocal campo="negocios" orden={orden} onPulsar={pulsar} inicial="desc">
                    Negocios
                  </ThLocal>
                  <ThLocal campo="abierto" orden={orden} onPulsar={pulsar} inicial="desc">
                    Abierto
                  </ThLocal>
                  <ThLocal campo="responsable" orden={orden} onPulsar={pulsar}>
                    Responsable
                  </ThLocal>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/organizaciones/${o.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {o.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[o.industry, o.taxId].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {/*
                        Se pinta siempre, también donde todas las filas son
                        prospectos. Un distintivo que solo aparece en un caso
                        obliga a razonar por ausencia —«no dice nada, entonces
                        será prospecto… ¿o se me olvidó cargarlo?»—. El título
                        explica de dónde sale.
                      */}
                      <span
                        title={
                          o.kind === "client"
                            ? "Ya compró: tiene un negocio ganado, un contrato firmado o cuenta de portal."
                            : "Todavía no tiene ninguna compra registrada."
                        }
                      >
                        <Badge className={ORG_KIND_STYLES[o.kind]}>
                          {label(ORG_KIND_LABELS, o.kind, locale)}
                        </Badge>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {o.phone ? (
                        <Telefono valor={o.phone} sinIcono />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {o.contacts > 0 ? (
                        o.contacts
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {o.openDeals > 0 ? (
                        o.openDeals
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {o.openDeals > 0 ? (
                        money(String(o.openValue), "MXN", locale)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {o.ownerName ? (
                        <span className="text-muted-foreground">{o.ownerName}</span>
                      ) : (
                        /*
                          Tomar una ficha de la bandeja común sin pedirle a nadie
                          que la reparta. Es un `form` y no un botón con
                          `onClick` porque la acción es una escritura del
                          servidor: así funciona también con el JavaScript a
                          medio cargar.
                        */
                        <form action={claimOrganization}>
                          <input type="hidden" name="id" value={o.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                          >
                            Tomarla
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
