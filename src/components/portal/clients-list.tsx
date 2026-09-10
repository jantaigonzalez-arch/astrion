"use client";

import { useMemo, useState } from "react";
import { SLA_HOURS } from "@/lib/tickets";
import { ThLocal, useOrdenLocal } from "@/components/portal/orden-local";
import { AlertTriangle, Building2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";
import { Telefono } from "@/components/portal/telefono";
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

/**
 * EL SEMÁFORO FISCAL DE UN CLIENTE, EN CUATRO ESTADOS.
 *
 * ── POR QUÉ CUATRO Y NO DOS ────────────────────────────────────────────────
 *
 * «Listo / no listo» escondería la distinción que más importa. Un cliente sin
 * expediente y uno con expediente sin validar están los dos «no listos», pero
 * lo que hay que hacer con cada uno es distinto: al primero hay que capturarle
 * el régimen y el código postal, al segundo basta con validarlo. Un solo rojo
 * para los dos manda a todo el mundo a abrir la ficha para averiguar cuál es.
 *
 * Y «validado» NO se pinta de verde alegremente: verde significa que el SAT
 * dijo que sí, no que los datos se vean bien. Todo lo demás es ámbar o rojo.
 */
function estadoFiscal(c: ClientListRow): { texto: string; clase: string; ayuda: string } {
  if (!c.rfcFiscal) {
    return {
      texto: "Sin expediente",
      clase: "bg-muted/40 text-muted-foreground ring-border",
      ayuda: c.taxId
        ? "Tiene RFC del padrón viejo, pero le faltan régimen y código postal fiscal: con eso no se puede timbrar."
        : "No tiene ni RFC. No se le puede facturar.",
    };
  }
  switch (c.validacion) {
    case "valido":
      return {
        texto: "Validado",
        clase: "bg-success/10 text-success ring-success/30",
        ayuda: "El SAT confirmó RFC, nombre y código postal.",
      };
    case "no_validado":
    case null:
    case undefined:
      return {
        texto: "Sin validar",
        clase: "bg-warning/10 text-warning ring-warning/30",
        ayuda:
          "El expediente está completo pero nadie lo ha contrastado contra el padrón del SAT. " +
          "Nombre y código postal solo los confirma el SAT.",
      };
    case "rfc_inexistente":
      return {
        texto: "RFC inexistente",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "El SAT no encuentra ese RFC en su padrón.",
      };
    case "nombre_no_coincide":
      return {
        texto: "Nombre no coincide",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "CFDI40147: el nombre no es el de la Constancia de Situación Fiscal.",
      };
    case "cp_no_coincide":
      return {
        texto: "CP no coincide",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "CFDI40148: el código postal no es el de la Constancia.",
      };
    default:
      return {
        texto: "Error al validar",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "La última validación no se pudo completar.",
      };
  }
}

export type ClientListRow = {
  id: string;
  name: string;
  /** El RFC que trajo el padrón de SAE: texto suelto, sin validar. Sirve para buscar. */
  taxId: string | null;
  /*
    ── EL EXPEDIENTE FISCAL, RESUMIDO EN UNA COLUMNA ──────────────────────

    `taxId` no basta para facturar y nunca bastó: es un RFC sin régimen, sin
    código postal y sin nadie que lo haya contrastado contra el padrón del SAT.
    Estos cuatro campos son el expediente de verdad, y viajan a la LISTA porque
    la pregunta de facturación no es «¿cuál es el RFC de este cliente?» sino
    «¿a cuáles puedo facturarles?» — que es una pregunta sobre la lista entera.
  */
  rfcFiscal: string | null;
  cpFiscal: string | null;
  regimenFiscal: string | null;
  /** `no_validado` | `valido` | `rfc_inexistente` | … | null si no hay expediente. */
  validacion: string | null;
  industry: string | null;
  /*
    Teléfono y contactos: los DATOS DE LA EMPRESA, no del servicio.

    Vivían únicamente en el catálogo de organizaciones, que no está en el menú,
    así que al mudar la ficha se quedaron sin ninguna pantalla que los enseñara.
    Y son lo primero que se busca cuando hay que llamar a un cliente: un cliente
    con cero contactos es una cuenta que no se puede atender sin salir a
    preguntar por quién responde ahí.
  */
  phone: string | null;
  contacts: number;
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
  /** Plazo propio de primera respuesta, en horas. Nulo = el general. */
  slaHours: number | null;
};

type Filter = "all" | "conAbiertos" | "sinPortal";

/**
 * Qué significa ordenar por cada columna.
 *
 * `tickets` ordena por los ABIERTOS y desempata por el total: quien tiene tres
 * abiertos pide atención antes que quien acumuló doscientos cerrados, y esa es
 * la pregunta que trae a alguien a ordenar esta columna.
 *
 * Las columnas que se dibujan «—» para quien no tiene cuenta de portal ordenan
 * por `null` en ese caso, no por cero: sin cuenta no es que tenga cero equipos,
 * es que no hay por dónde saberlo, y `useOrdenLocal` manda lo vacío al final.
 */
const VALORES = {
  nombre: (c: ClientListRow) => c.name,
  // Cero contactos es un hueco de verdad —no hay a quién llamar—, así que ordena
  // como nulo y `useOrdenLocal` lo manda al final en las dos direcciones. Es la
  // misma decisión que en la cartera de prospectos.
  contactos: (c: ClientListRow) => (c.contacts > 0 ? c.contacts : null),
  contratos: (c: ClientListRow) => (c.hasPortal ? c.contracts : null),
  equipos: (c: ClientListRow) => (c.hasPortal ? c.equipment : null),
  tickets: (c: ClientListRow) =>
    c.hasPortal ? c.openTickets * 10_000 + c.totalTickets : null,
  ultimo: (c: ClientListRow) => (c.hasPortal ? c.lastTicketAt : null),
  comprado: (c: ClientListRow) => (c.wonDeals > 0 ? c.wonValue : null),
  // Nulo para quien no pactó nada, así que ordenar por SLA agrupa arriba a los
  // que sí tienen un plazo propio —que es la pregunta— y manda al final a los
  // que van con el general. Ver `useOrdenLocal`.
  sla: (c: ClientListRow) => c.slaHours,
  responsable: (c: ClientListRow) => c.ownerName,
} as const;

type CampoCliente = keyof typeof VALORES;

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

  const filtrados = useMemo(() => {
    const term = norm(q.trim());
    return clients.filter((c) => {
      if (filter === "conAbiertos" && c.openTickets === 0) return false;
      if (filter === "sinPortal" && c.hasPortal) return false;
      if (!term) return true;
      return norm(
        // Los DOS RFC: quien busca «AAA010101AA1» no sabe —ni tiene por qué
        // saber— si esa ficha ya tiene expediente fiscal o solo el dato viejo
        // del padrón. Buscar por uno y no por el otro deja al cliente sin
        // aparecer justo cuando se le busca por el número que se tiene a mano.
        [c.name, c.taxId, c.rfcFiscal, c.cpFiscal, c.industry, c.phone]
          .filter(Boolean)
          .join(" "),
      ).includes(term);
    });
  }, [clients, q, filter]);

  /*
    El orden se aplica DESPUÉS de filtrar, y sobre la lista entera: aquí no hay
    paginación, así que ordenar no esconde nada. Ver `useOrdenLocal`.

    Arranca por nombre y no por volumen de tickets porque este listado se usa
    sobre todo para BUSCAR a alguien, y para eso el alfabeto gana a cualquier
    ranking. Quien viene a ver quién pesa más pulsa la columna.
  */
  const { orden, pulsar, ordenadas: filtered } = useOrdenLocal<ClientListRow, CampoCliente>(
    filtrados,
    VALORES,
    { campo: "nombre", dir: "asc" },
  );

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
            placeholder="Buscar por nombre, RFC, giro o teléfono…"
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
          <div className="tabla-caja overflow-x-auto">
            {/*
              `data-tabla` es lo que le da anchos arrastrables: sin él, esta era
              la única lista grande del sistema cuyas columnas no se podían
              estrechar. Ver `anchos-de-columna.tsx`.
            */}
            <table data-tabla="clientes" className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <ThLocal campo="nombre" orden={orden} onPulsar={pulsar}>
                    Cliente
                  </ThLocal>
                  {/*
                    Segunda columna, pegada al nombre y antes que el teléfono.

                    El orden de las columnas es una declaración de qué importa.
                    El RFC vivía escondido bajo el nombre, concatenado con el
                    giro y separado por un punto medio: estaba, y nadie lo veía.
                    Para un ERP mexicano el estado fiscal de un cliente no es un
                    detalle de su ficha, es lo que decide si se le puede cobrar.
                  */}
                  <th className="px-4 py-3 font-medium">Fiscal</th>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <ThLocal campo="contactos" orden={orden} onPulsar={pulsar} inicial="desc">
                    Contactos
                  </ThLocal>
                  <ThLocal campo="contratos" orden={orden} onPulsar={pulsar} inicial="desc">
                    Contratos
                  </ThLocal>
                  <ThLocal campo="equipos" orden={orden} onPulsar={pulsar} inicial="desc">
                    Equipos
                  </ThLocal>
                  <ThLocal campo="tickets" orden={orden} onPulsar={pulsar} inicial="desc">
                    Tickets
                  </ThLocal>
                  <ThLocal campo="ultimo" orden={orden} onPulsar={pulsar} inicial="desc">
                    Último servicio
                  </ThLocal>
                  <ThLocal
                    campo="comprado"
                    orden={orden}
                    onPulsar={pulsar}
                    inicial="desc"
                    className="text-right"
                  >
                    Comprado
                  </ThLocal>
                  {/*
                    EL PLAZO PACTADO, EN LA PANTALLA DONDE VIVE EL CLIENTE.

                    Se configura en la ficha de la organización, que está en
                    Ventas: a tres clics de aquí y en otra sección del menú. Se
                    puso ahí porque ahí vive el formulario, y el resultado fue
                    que quien administra clientes no lo encontraba.

                    Aquí no se edita, se VE —y se ve de un vistazo quién tiene
                    algo pactado y quién no, que es la pregunta que se hace al
                    mirar una cartera—. El enlace lleva a cambiarlo.
                  */}
                  <ThLocal campo="sla" orden={orden} onPulsar={pulsar} inicial="desc">
                    SLA
                  </ThLocal>
                  <ThLocal campo="responsable" orden={orden} onPulsar={pulsar}>
                    Responsable
                  </ThLocal>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/organizaciones/${c.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.industry || "—"}
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
                    <td className="px-4 py-3">
                      {(() => {
                        const e = estadoFiscal(c);
                        return (
                          <div className="space-y-1" title={e.ayuda}>
                            <Badge className={e.clase}>{e.texto}</Badge>
                            {/*
                              El RFC del expediente y el del padrón viejo se
                              enseñan distinto A PROPÓSITO. El segundo va en
                              gris y con nota: que exista un RFC no significa
                              que se pueda facturar con él, y presentarlos igual
                              es exactamente cómo alguien da por bueno un
                              expediente que no lo está.
                            */}
                            {c.rfcFiscal ? (
                              <p className="font-mono text-xs tabular-nums">
                                {c.rfcFiscal}
                                {c.cpFiscal && (
                                  <span className="text-muted-foreground">
                                    {" · CP "}
                                    {c.cpFiscal}
                                  </span>
                                )}
                                {c.regimenFiscal && (
                                  <span className="text-muted-foreground">
                                    {" · "}
                                    {c.regimenFiscal}
                                  </span>
                                )}
                              </p>
                            ) : c.taxId ? (
                              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                                {c.taxId}
                                <span className="ml-1 font-sans not-italic">(del padrón)</span>
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sin RFC</p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.phone ? (
                        <Telefono valor={c.phone} sinIcono />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {c.contacts > 0 ? (
                        c.contacts
                      ) : (
                        <span className="text-muted-foreground">0</span>
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
                    <td data-num className="px-4 py-3 text-right tabular-nums">
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
                    <td className="px-4 py-3">
                      {/*
                        Nulo se dice «General», no se deja en blanco ni se pinta
                        un guion: el campo vacío se leería como «este cliente no
                        tiene compromiso», y lo tiene — el de siempre. Es el
                        mismo cuidado que en el formulario que lo captura.
                      */}
                      {c.slaHours ? (
                        <Link
                          href={`/admin/organizaciones/${c.id}/editar`}
                          className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/15"
                          title="Plazo pactado con este cliente. Pulsa para cambiarlo."
                        >
                          {c.slaHours} h
                        </Link>
                      ) : (
                        <Link
                          href={`/admin/organizaciones/${c.id}/editar`}
                          className="text-xs text-muted-foreground hover:text-primary"
                          title={`Sin plazo propio: se le aplica el general de ${SLA_HOURS} h. Pulsa para pactar uno.`}
                        >
                          General
                        </Link>
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
