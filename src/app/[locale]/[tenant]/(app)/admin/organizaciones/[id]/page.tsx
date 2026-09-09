import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CalendarClock,
  FileSignature,
  Globe,
  Timer,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  StickyNote,
  Ticket,
  User2,
} from "lucide-react";
import {
  getOrganizationById,
  getOrganizationPortalData,
  kindDeOrganizacion,
} from "@/lib/data/crm";
import {
  ACTIVITY_LABELS,
  ACTIVITY_STYLES,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_STYLES,
  ORG_KIND_LABELS,
  ORG_KIND_STYLES,
  label,
  money,
} from "@/lib/crm";
import { SLA_HOURS } from "@/lib/tickets";
import { domicilioEnUnaLinea } from "@/lib/domicilio";
import { Telefono } from "@/components/portal/telefono";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import {
  ActivityQuickForm,
  ActivityToggle,
  NoteForm,
} from "@/components/portal/crm/deal-panels";
import { CostoDeViaje } from "@/components/portal/viaticos/costo-de-viaje";
import { viaticosDelProspecto } from "@/lib/data/viaticos";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const org = await getOrganizationById(id);
  if (!org) notFound();

  /*
    LAS TRES QUE DEPENDEN DE `org` VAN JUNTAS.

    Iban en cascada —el portal, luego el tipo, luego los viajes— y ninguna
    necesita el resultado de la anterior: solo el `org` que ya está arriba. En
    serie son tres idas y vueltas a la base una detrás de otra; la última la
    añadí yo al montar el costo de visitarlos, y la puse detrás sin mirar.

    `Promise.all` no las hace más baratas, las hace simultáneas — que con dos
    conexiones por empresa es además una manera de soltar antes la que se ocupa.
  */
  const [portal, kind, viajes] = await Promise.all([
    // Todo lo que ya existe en el portal para este laboratorio.
    getOrganizationPortalData(org.clientId),
    kindDeOrganizacion(org.id),
    viaticosDelProspecto(org.id),
  ]);

  const intl = locale === "en" ? "en-US" : "es-MX";
  const fmtDateTime = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }) : "—";

  /*
    ES CLIENTE O ES PROSPECTO, Y LA FICHA LO DICE.

    Es la misma empresa y el mismo registro: lo que cambia es en qué punto del
    embudo está. Mientras no compra la trabaja Ventas; cuando compra, pasa a
    atenderla Servicio. Enseñarlo arriba es lo que evita que un vendedor
    prospecte a alguien que ya nos compra —y lo que explica por qué debajo
    aparecen unas cosas u otras—.
  */
  const esCliente = kind === "client";

  /*
    LO QUE SE HA GASTADO EN IR A VER A ESTA EMPRESA.

    Se pide para las dos mitades —cliente y prospecto— y no solo para los
    prospectos: una empresa que hoy es cliente tuvo antes viajes de prospección
    colgados de esta misma ficha, y esconderlos al ganarla haría desaparecer lo
    que costó ganarla justo en el momento en que la pregunta empieza a tener
    respuesta. Es la misma ficha en dos momentos, como dice el encabezado de
    Prospectos.
  */

  const openDeals = org.deals.filter((d) => d.status === "open");
  const openValue = openDeals.reduce((a, d) => a + Number(d.valueMxn ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={esCliente ? "/admin/clientes" : "/admin/crm/prospectos"}>
            <ArrowLeft className="size-4" />{" "}
            {esCliente ? "Clientes" : "Prospectos"}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            <Badge className={ORG_KIND_STYLES[kind]}>
              {label(ORG_KIND_LABELS, kind, locale)}
            </Badge>
            {/*
              Ser cliente y TENER CUENTA DE PORTAL no son lo mismo, y la ficha
              los decía con una sola insignia. Se es cliente por haber comprado;
              la cuenta es el acceso que se le abre después, y hay clientes de
              años que no la tienen. Confundirlos hacía que un cliente sin
              cuenta se leyera como prospecto.
            */}
            {org.client && (
              <Badge className="bg-secondary text-muted-foreground ring-border">
                Con acceso al portal
              </Badge>
            )}
          </div>
          {org.industry && (
            <p className="text-sm text-muted-foreground">{org.industry}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/organizaciones/${org.id}/editar`}>
              <Pencil className="size-3.5" /> Editar
            </Link>
          </Button>
          <Button asChild variant="accent" size="sm">
            <Link href={`/admin/crm/negocios/nuevo?org=${org.id}`}>
              <Plus className="size-4" /> Nuevo negocio
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Negocios */}
          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Negocios
              </h2>
              <span className="font-mono text-sm font-semibold text-gradient-brand">
                {money(String(openValue), "MXN", locale)}
              </span>
            </div>
            {org.deals.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Todavía no hay oportunidades registradas.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {org.deals.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/crm/negocios/${d.id}`}
                        className="text-sm font-medium hover:text-primary"
                      >
                        {d.title}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {d.reference} · {d.stage?.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm">
                        {money(d.valueMxn, "MXN", locale)}
                      </span>
                      <Badge className={DEAL_STATUS_STYLES[d.status]}>
                        {label(DEAL_STATUS_LABELS, d.status, locale)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Contratos, equipos y tickets: lo que ya vive en el portal */}
          {/*
            EL BLOQUE DE CLIENTE SOLO SALE CUANDO YA LO ES.

            Antes dependía de tener cuenta de portal, que es otra cosa: un
            cliente de contrato sin acceso al portal veía el cartel de «todavía
            no está vinculada» —o sea, se le hablaba como a un prospecto—, y a
            un prospecto de verdad se le ofrecía vincular una cuenta que no
            tiene por qué existir. Ahora manda el embudo: compró o no compró.
          */}
          {esCliente ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Relación como cliente
              </h2>

              {/*
                EL SLA, ARRIBA Y EN LA FICHA DEL CLIENTE.

                Vivía únicamente dentro del formulario de edición, así que para
                saber qué se le prometió a una empresa había que entrar a
                cambiarlo. Se reportó tal cual: «no veo la opción de SLA en cada
                uno de los clientes». Aquí se lee sin tocar nada.

                Nulo se dice «el general», nunca en blanco: el hueco se leería
                como «no hay compromiso», y lo hay.
              */}
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/30 p-3">
                <Timer className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Primera respuesta comprometida
                </span>
                {org.slaHours ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20">
                    {org.slaHours} h · pactado con este cliente
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {SLA_HOURS} h · el general, no pactó uno propio
                  </span>
                )}
                <Link
                  href={`/admin/organizaciones/${org.id}/editar`}
                  className="ml-auto text-xs text-primary hover:underline"
                >
                  Cambiar
                </Link>
              </div>

              {!org.clientId && (
                <p className="mt-4 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Ya es cliente, pero todavía no tiene{" "}
                  <strong>cuenta de portal</strong>: no puede levantar tickets
                  por su cuenta ni ver sus equipos.{" "}
                  <Link
                    href={`/admin/organizaciones/${org.id}/editar`}
                    className="text-primary hover:underline"
                  >
                    Vincular una
                  </Link>
                  .
                </p>
              )}

              <div className="mt-4 grid gap-5 sm:grid-cols-3">
                {/* Contratos */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <FileSignature className="size-3.5" /> Contratos (
                    {portal.contracts.length})
                  </p>
                  {portal.contracts.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Ninguno.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {portal.contracts.map((c) => (
                        <li key={c.id} className="text-sm">
                          <Link
                            href={`/admin/contratos/${c.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {c.number}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {money(c.amountMxn, "MXN", locale)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Equipos */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Boxes className="size-3.5" /> Equipos (
                    {portal.equipment.length})
                  </p>
                  {portal.equipment.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Ninguno.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {portal.equipment.map((e) => (
                        <li key={e.id} className="text-sm">
                          {e.brand} {e.name}
                          <p className="text-xs text-muted-foreground">
                            {e.modules.length} módulo(s)
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Tickets */}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Ticket className="size-3.5" /> Tickets recientes (
                    {portal.tickets.length})
                  </p>
                  {portal.tickets.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Ninguno.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {portal.tickets.map((t) => (
                        <li key={t.id} className="text-sm">
                          <Link
                            href={`/admin/tickets`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {t.reference}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.subject}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="border-dashed p-5">
              <p className="text-sm text-muted-foreground">
                Todavía es un <strong>prospecto</strong>: no tiene ninguna compra
                registrada. En cuanto se gane un negocio pasa a cliente sola, y
                aquí aparecerán sus <strong>contratos</strong>,{" "}
                <strong>equipos</strong> y <strong>tickets</strong>, y el plazo
                de respuesta que se le prometa.
              </p>
              <Button asChild variant="accent" size="sm" className="mt-4">
                <Link href={`/admin/crm/negocios/nuevo?org=${org.id}`}>
                  <Plus className="size-4" /> Registrar un negocio
                </Link>
              </Button>
            </Card>
          )}

          {/*
            Solo cuando hay viajes cerrados. Una tarjeta en cero en las ciento
            sesenta y una fichas —a la mayoría no se viaja nunca— sería ruido
            permanente para servir a unas pocas.
          */}
          {viajes.viajes > 0 ? (
            <CostoDeViaje
              viajes={viajes.viajes}
              costo={viajes.costo}
              porCategoria={viajes.porCategoria}
              titulo="Costo de visitarlos"
              pieVacio=""
            />
          ) : null}

          {/* Actividades */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-4" /> Actividades
            </h2>
            <div className="mt-4">
              <ActivityQuickForm organizationId={org.id} locale={locale} />
            </div>
            {org.activities.length > 0 && (
              <ul className="mt-5 space-y-2">
                {org.activities.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-secondary/30 p-3"
                  >
                    <ActivityToggle id={a.id} done={a.done} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={ACTIVITY_STYLES[a.type]}>
                          {label(ACTIVITY_LABELS, a.type, locale)}
                        </Badge>
                        <span
                          className={`text-sm font-medium ${a.done ? "text-muted-foreground line-through" : ""}`}
                        >
                          {a.subject}
                        </span>
                      </div>
                      {a.dueAt && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {fmtDateTime(a.dueAt)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Notas */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <StickyNote className="size-4" /> Notas
            </h2>
            <div className="mt-4">
              <NoteForm organizationId={org.id} />
            </div>
            {org.notes.length > 0 && (
              <ul className="mt-5 space-y-3">
                {org.notes.map((n) => (
                  <li key={n.id} className="rounded-xl border border-border p-3">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {n.author?.name ?? n.author?.email ?? "Sistema"} ·{" "}
                      {fmtDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Lateral */}
        <div className="space-y-6">
          <Card className="space-y-3 p-5 text-sm">
            <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Building2 className="size-3.5" /> Datos
            </h2>
            <Telefono valor={org.phone} className="flex gap-2" iconClassName="size-4" />
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 truncate text-muted-foreground hover:text-primary"
              >
                <Globe className="size-4 shrink-0" /> {org.website}
              </a>
            )}
            {/*
              EL DOMICILIO ESTRUCTURADO MANDA; EL TEXTO SUELTO ES EL RESPALDO.

              Se compone de los campos del SAT y solo se cae al `address` de
              origen cuando no hay ninguno capturado. Enseñar los dos a la vez
              sería enseñar el mismo domicilio dos veces y en desacuerdo el día
              que alguien corrija uno solo.
            */}
            {domicilioEnUnaLinea(org) ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                {domicilioEnUnaLinea(org)}
              </p>
            ) : (
              org.address && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0" /> {org.address}
                </p>
              )
            )}
            {org.addressReference && (
              <p className="pl-6 text-xs text-muted-foreground">
                {org.addressReference}
              </p>
            )}
            {/*
              El RFC y el código postal, juntos y a la vista: son los dos datos
              que hay que cuadrar contra la Constancia de Situación Fiscal antes
              de timbrarle nada, y el CP es el que más rechazos causa.
            */}
            {(org.taxId || org.postalCode) && (
              <p className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Datos fiscales:</span>
                {org.taxId ? (
                  <span className="font-mono font-medium">{org.taxId}</span>
                ) : (
                  <span className="text-warning">sin RFC</span>
                )}
                {org.postalCode ? (
                  <span className="font-mono font-medium">C.P. {org.postalCode}</span>
                ) : (
                  <span className="text-warning">sin código postal</span>
                )}
              </p>
            )}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Responsable: {org.owner?.name ?? org.owner?.email ?? "Sin asignar"}
            </p>
            {org.notes && org.notes.length === 0 && null}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <User2 className="size-3.5" /> Contactos
            </h2>
            {org.contacts.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Sin contactos.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {org.contacts.map((c) => (
                  <li key={c.id} className="text-sm">
                    <p className="font-medium">{c.name}</p>
                    {c.position && (
                      <p className="text-xs text-muted-foreground">{c.position}</p>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                      >
                        <Mail className="size-3" /> {c.email}
                      </a>
                    )}
                    <Telefono valor={c.phone} className="text-xs" iconClassName="size-3" />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link href={`/admin/crm/contactos/nuevo?org=${org.id}`}>
                <Plus className="size-3.5" /> Agregar contacto
              </Link>
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
