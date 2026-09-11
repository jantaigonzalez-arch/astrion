import { SLA_HOURS } from "@/lib/tickets";
import { ThOrden } from "@/components/portal/listado-controles";
import { AlertTriangle, Building2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { estadoFiscal } from "@/lib/cliente-fiscal";
import type { CampoCartera } from "@/lib/data/crm";
import { Link } from "@/lib/nav";
import { FormularioGet } from "@/components/portal/formulario-get";
import { Telefono } from "@/components/portal/telefono";
import { ColumnasVisibles } from "@/components/portal/columnas-visibles";
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
/*
  ── ESTA TABLA YA NO ORDENA NI FILTRA EN EL NAVEGADOR ─────────────────────

  Lo hacía, y con veintitrés filas estaba bien. Con la lista paginada deja de
  estarlo, y no por rendimiento: buscar en el navegador solo encontraría a
  quienes caen en la página que se está mirando, y ordenar reordenaría
  veinticinco filas de doscientas —cambiaría lo que se ve, no CUÁLES—. La cola
  de tickets ya tenía escrita esa misma lección.

  Así que recortar, buscar y ordenar se deciden en el MISMO sitio: el servidor.
  Este componente pasa a ser de servidor y a pintar lo que le dan; el estado
  vive en la URL, que además se puede compartir y marcar.

  Lo único que sigue siendo de cliente es el selector de columnas, que es una
  preferencia del navegador y no una consulta.
*/

export function ClientsList({
  clients,
  locale,
  total,
  q,
  filtro,
  orden,
  basePath,
  totalSinFiltro,
  conAbiertos,
  sinPortal,
}: {
  /** Solo las filas de ESTA página. */
  clients: ClientListRow[];
  locale: string;
  /** Cuántas hay con los filtros puestos. Lo dice el pie y lo usa el paginador. */
  total: number;
  q: string;
  filtro: Filter;
  orden: { campo: CampoCartera; dir: "asc" | "desc" };
  basePath: string;
  /** Conteos de cada ficha, calculados en la base sobre la cartera ENTERA. */
  totalSinFiltro: number;
  conAbiertos: number;
  sinPortal: number;
}) {
  /*
    La consulta que viaja en cada enlace. Sin ella, pulsar una columna para
    ordenar perdería la búsqueda que se acababa de escribir.

    `page` se omite a propósito: al cambiar el orden o el filtro se vuelve a la
    primera página. Quedarse en la siete después de filtrar es la forma más
    rápida de enseñar una lista vacía y que parezca que no hay resultados.
  */
  const consulta = {
    q: q || undefined,
    filtro: filtro === "all" ? undefined : filtro,
    campo: orden.campo === "nombre" ? undefined : orden.campo,
    dir: orden.dir === "asc" ? undefined : orden.dir,
  };
  /*
    Las filas llegan ya recortadas, buscadas y ordenadas por la base. Aquí no se
    filtra ni se ordena nada: hacerlo sería reordenar una página y mentir sobre
    cuál es la primera de la lista.
  */
  const filtered = clients;

  /*
    Un enlace a esta misma pantalla cambiando UNA cosa y conservando el resto.

    Sin esto, cada control tendría que acordarse de arrastrar los otros tres, y
    el que se olvidara borraría en silencio la búsqueda de alguien.
  */
  const enlace = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...consulta, ...cambios })) {
      if (v) p.set(k, v);
    }
    const cola = p.toString();
    return cola ? `${basePath}?${cola}` : basePath;
  };

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
        {/*
          UN FORMULARIO, NO UN CAMPO QUE FILTRA AL TECLEAR.

          Con la lista paginada la búsqueda tiene que ir a la base, y una consulta
          por cada tecla sería una consulta por cada tecla. Se envía al pulsar
          Enter, que además deja la búsqueda en la URL — se comparte, se marca y
          el botón de atrás la deshace.

          Por `FormularioGet` y no un `<form action>` crudo, que en producción
          perdía el prefijo de la empresa y mandaba a un 404. Los demás
          parámetros viajan como campos ocultos para que buscar no borre el orden
          ni el filtro que ya estaban puestos.
        */}
        <FormularioGet
          action={basePath}
          className="flex items-center gap-2 rounded-lg border border-input bg-background px-3"
        >
          {filtro !== "all" && <input type="hidden" name="filtro" value={filtro} />}
          {orden.campo !== "nombre" && <input type="hidden" name="campo" value={orden.campo} />}
          {orden.dir !== "asc" && <input type="hidden" name="dir" value={orden.dir} />}
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, RFC, código postal, giro o teléfono…"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Buscar cliente"
          />
          {q && (
            <Link
              href={enlace({ q: undefined })}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </Link>
          )}
        </FormularioGet>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/*
            Enlaces y no botones: el filtro vive en la URL, así que se puede
            compartir, marcar y volver con el botón de atrás. Los conteos salen
            de la BASE y no de las filas que hay a mano — con la lista paginada,
            contar lo que se ve daría «Con tickets abiertos (7)» cuando hay
            dieciséis.
          */}
          <Link href={enlace({ filtro: undefined })} className={chip(filtro === "all")}>
            Todos ({totalSinFiltro})
          </Link>
          <Link
            href={enlace({ filtro: "conAbiertos" })}
            className={chip(filtro === "conAbiertos")}
          >
            Con tickets abiertos ({conAbiertos})
          </Link>
          {sinPortal > 0 && (
            <Link
              href={enlace({ filtro: "sinPortal" })}
              className={chip(filtro === "sinPortal")}
            >
              Sin cuenta de portal ({sinPortal})
            </Link>
          )}

          {/*
            El selector de columnas, al final de la fila de filtros y separado
            por `ml-auto`.

            Va aquí y no sobre la tabla porque es lo mismo que los filtros: una
            decisión sobre QUÉ se ve. Un control de la tabla flotando aparte
            obliga a buscarlo, y el sitio donde alguien busca «ver menos» es
            donde ya está eligiendo «ver solo los que tienen tickets».

            Son doce columnas y no caben en una pantalla normal. La tabla se
            desplaza —con su barra a la vista, que es una decisión anotada en
            `globals.css`, no un descuido— y esto es el control para quien
            prefiera menos columnas a más desplazamiento.
          */}
          <div className="ml-auto">
            <ColumnasVisibles tabla="clientes" />
          </div>
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
                  <ThOrden campo="nombre" actual={orden} basePath={basePath} query={consulta}>
                    Cliente
                  </ThOrden>
                  {/*
                    DOS COLUMNAS, NO UNA CELDA CON CUATRO DATOS DENTRO.

                    La primera versión metía estado, RFC, código postal y régimen
                    en la misma celda, separados por puntos medios — que es
                    exactamente el defecto que esta columna vino a corregir: el
                    RFC estaba antes escondido bajo el nombre como «giro · RFC».
                    Cambiar un empaquetado por otro no arregla nada.

                    Una tabla es una rejilla: cada dato en su columna se puede
                    ordenar, comparar en vertical y leer de un vistazo. Empaquetados
                    en una celda no se puede hacer ninguna de las tres.

                    Régimen y CP se van a la FICHA. Nadie recorre una lista de
                    clientes buscando por régimen fiscal; son datos del
                    expediente, y en la lista solo ocupan ancho.
                  */}
                  <ThOrden campo="fiscal" actual={orden} basePath={basePath} query={consulta}>
                    Estado fiscal
                  </ThOrden>
                  <ThOrden campo="rfc" actual={orden} basePath={basePath} query={consulta}>
                    RFC
                  </ThOrden>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <ThOrden campo="contactos" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    Contactos
                  </ThOrden>
                  <ThOrden campo="contratos" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    Contratos
                  </ThOrden>
                  <ThOrden campo="equipos" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    Equipos
                  </ThOrden>
                  <ThOrden campo="tickets" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    Tickets
                  </ThOrden>
                  <ThOrden campo="ultimo" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    Último servicio
                  </ThOrden>
                  <ThOrden
                    campo="comprado"
                    actual={orden}
                    basePath={basePath}
                    query={consulta}
                    inicial="desc"
                    className="text-right"
                  >
                    Comprado
                  </ThOrden>
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
                  <ThOrden campo="sla" actual={orden} basePath={basePath} query={consulta} inicial="desc">
                    SLA
                  </ThOrden>
                  <ThOrden campo="responsable" actual={orden} basePath={basePath} query={consulta}>
                    Responsable
                  </ThOrden>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-secondary/40">
                    <td className="min-w-[26ch] px-4 py-3">
                      {/*
                        Y UN PISO, `min-w-[26ch]`: las columnas de la derecha no
                        se parten, así que la tabla le deja a ésta solo su mínimo.
                        Sin piso, medido: 158 px y la razón social más larga en 7
                        renglones; con él, 230 px y 5. Va en la celda y no en
                        `globals.css` porque muchas primeras columnas son un folio
                        o una fecha, y el piso les regalaría el mismo ancho.

                        EL TECHO VA DENTRO DE LA CELDA, no solo en el `max-width`
                        de `globals.css`.

                        `max-width` sobre un `<td>` lo ignoran varios navegadores
                        cuando el reparto de la tabla es automático — está así en
                        la especificación—. Un contenedor DENTRO de la celda sí se
                        respeta siempre, y es lo que de verdad impide que esta
                        columna, que está fijada al desplazarse, crezca hasta
                        tapar las tres siguientes.

                        Los nombres son razones sociales completas y se parten en
                        dos renglones. Aquí es aceptable: es un nombre, no una
                        cifra que haya que comparar en vertical.
                      */}
                      <div className="max-w-[34ch]">
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
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {(() => {
                        const e = estadoFiscal(c);
                        return (
                          // `title` en el envoltorio: `Badge` no lo acepta, y
                          // ampliar su API para una pantalla sería cambiarle la
                          // forma a un componente que usan otras diez.
                          <span title={e.ayuda}>
                            <Badge className={e.clase}>{e.texto}</Badge>
                          </span>
                        );
                      })()}
                    </td>
                    {/*
                      El RFC en su columna, y `tabular-nums` SÍ es lo correcto
                      aquí: es una columna de códigos de la misma longitud que se
                      leen en vertical, que es justo el caso para el que existen
                      las cifras tabulares. Lo que no las quiere es un número
                      grande y suelto, como el valor de una tarjeta de indicador.
                    */}
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">
                      {c.rfcFiscal ? (
                        c.rfcFiscal
                      ) : c.taxId ? (
                        // El del padrón, en gris: que exista un RFC no significa
                        // que se pueda facturar con él, y presentarlos igual es
                        // cómo alguien da por bueno un expediente que no lo está.
                        <span className="text-muted-foreground" title="Del padrón de SAE, sin expediente fiscal">
                          {c.taxId}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
            {/* El total de la BASE, no las filas de esta página: «10 de 10» no dice nada. */}
            {filtered.length} de {total} cliente(s)
          </p>
        </Card>
      )}
    </div>
  );
}
