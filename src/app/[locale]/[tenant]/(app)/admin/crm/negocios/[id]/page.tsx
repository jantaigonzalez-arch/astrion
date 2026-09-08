import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  FileSignature,
  History,
  Mail,
  PackageSearch,
  Pencil,
  Plane,
  StickyNote,
  Tag,
  Trash2,
  User2,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole, isSupport } from "@/lib/roles";
import { getContractForDeal, getDealById, kindDeOrganizacion } from "@/lib/data/crm";
import {
  getCatalogOptions,
  getEmailTemplates,
  getLabels,
} from "@/lib/data/crm-insights";
import { deleteDeal } from "@/lib/actions/crm";
import {
  ACTIVITY_LABELS,
  ACTIVITY_STYLES,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_STYLES,
  ORG_KIND_LABELS,
  ORG_KIND_STYLES,
  SOURCE_LABELS,
  label,
  money,
  weightedValue,
} from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { Telefono } from "@/components/portal/telefono";
import { currentRole } from "@/lib/tenancy/context";
import {
  ActivityQuickForm,
  ActivityToggle,
  DealStatusPanel,
  NoteForm,
} from "@/components/portal/crm/deal-panels";
import {
  DealItemsPanel,
  EmailComposer,
  LabelPicker,
} from "@/components/portal/crm/deal-extras";
import { DealSupplyPanel } from "@/components/portal/crm/deal-supply";
import { viaticosPorNegocio } from "@/lib/data/viaticos";
import { mxnViatico } from "@/lib/viaticos";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const deal = await getDealById(id);
  if (!deal) notFound();

  // Si la empresa del negocio ya nos compra. Vender a un cliente no es lo mismo
  // que abrir una cuenta nueva, y desde el embudo no había forma de saberlo.
  const orgKind = deal.organization
    ? await kindDeOrganizacion(deal.organization.id)
    : null;

  const session = await auth();
  const role = await currentRole();
  const admin = isAdminRole(role);
  const support = isSupport(role);
  const intl = locale === "en" ? "en-US" : "es-MX";

  const [labels, catalog, templates, linkedContract, viajes] = await Promise.all([
    getLabels(),
    getCatalogOptions(),
    getEmailTemplates(),
    getContractForDeal(deal.id),
    /*
      LO QUE LLEVAMOS GASTADO EN CERRAR ESTE NEGOCIO.

      Se pregunta por los GASTOS cargados a esta oportunidad y no por los
      viáticos que la nombran: un viaje de prospección puede cargarle una comida
      a la oportunidad y dejar el hotel como gasto comercial del viaje. Sumar el
      viático entero le cargaría al negocio un viaje que fue por tres cosas.
    */
    viaticosPorNegocio([deal.id]),
  ]);
  const costoDeViaje = viajes.get(deal.id) ?? 0;

  const fmtDateTime = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }) : "—";
  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(intl, { dateStyle: "medium" }) : "—";

  const pending = deal.activities.filter((a) => !a.done);
  const doneActs = deal.activities.filter((a) => a.done);
  const overdue = (d: Date | null) => d != null && new Date(d) < new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/crm">
            <ArrowLeft className="size-4" /> Embudo
          </Link>
        </Button>
      </div>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              {deal.reference}
            </span>
            <Badge className={DEAL_STATUS_STYLES[deal.status]}>
              {label(DEAL_STATUS_LABELS, deal.status, locale)}
            </Badge>
            <Badge className="bg-primary/10 text-primary ring-primary/20">
              {deal.stage.name} · {deal.stage.probability}%
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{deal.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/crm/negocios/${deal.id}/editar`}>
              <Pencil className="size-3.5" /> Editar
            </Link>
          </Button>
          {admin && (
            <form action={deleteDeal}>
              <input type="hidden" name="id" value={deal.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" /> Eliminar
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Columna principal */}
        <div className="space-y-6 lg:col-span-2">
          {/* Productos / cotización */}
          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <PackageSearch className="size-4" /> Productos y servicios
            </h2>
            <DealItemsPanel
              dealId={deal.id}
              items={deal.items}
              catalog={catalog}
              locale={locale}
            />
          </Card>

          {/* Surtido: qué hay que comprar para este pedido, ya restado lo que
              está en almacén y lo que viene en camino. Va pegado a los
              productos porque es la pregunta que sigue de leerlos. El vendedor
              lo ve para poder contestarle al cliente; levantar la requisición
              es de operación. */}
          <DealSupplyPanel dealId={deal.id} puedeRequisitar={support} />

          {/* Actividades */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-4" /> Actividades
            </h2>

            <div className="mt-4">
              <ActivityQuickForm dealId={deal.id} locale={locale} />
            </div>

            {deal.activities.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Sin actividades agendadas. Programa el siguiente paso para que el
                negocio no se enfríe.
              </p>
            ) : (
              <ul className="mt-5 space-y-2">
                {[...pending, ...doneActs].map((a) => (
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
                      {a.notes && (
                        <p className="mt-1 text-sm text-muted-foreground">{a.notes}</p>
                      )}
                      {a.dueAt && (
                        <p
                          className={`mt-1 text-xs ${
                            !a.done && overdue(a.dueAt)
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          {!a.done && overdue(a.dueAt) ? "Vencida: " : "Vence: "}
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
              <NoteForm dealId={deal.id} />
            </div>
            {deal.notes.length > 0 && (
              <ul className="mt-5 space-y-3">
                {deal.notes.map((n) => (
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

          {/* Bitácora de avance */}
          {deal.events.length > 0 && (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <History className="size-4" /> Avance del negocio
              </h2>
              <ul className="mt-4 space-y-3">
                {deal.events.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div>
                      <p>
                        {e.status && e.status !== "open"
                          ? `Negocio marcado como ${label(DEAL_STATUS_LABELS, e.status, locale).toLowerCase()}`
                          : e.fromStage
                            ? `${e.fromStage.name} → ${e.toStage?.name ?? "—"}`
                            : `Creado en ${e.toStage?.name ?? "—"}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.author?.name ?? e.author?.email ?? "Sistema"} ·{" "}
                        {fmtDateTime(e.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Panel lateral */}
        <div className="space-y-6">
          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Valor del negocio
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-gradient-brand">
              {money(deal.valueMxn, "MXN", locale)}
            </p>
            {deal.valueUsd && (
              <p className="font-mono text-sm text-muted-foreground">
                {money(deal.valueUsd, "USD", locale)}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Ponderado ({deal.stage.probability}%):{" "}
              <span className="font-mono">
                {money(
                  String(weightedValue(deal.valueMxn, deal.stage.probability)),
                  "MXN",
                  locale,
                )}
              </span>
            </p>

            <div className="mt-4 border-t border-border pt-4">
              <DealStatusPanel dealId={deal.id} status={deal.status} />
            </div>

            {deal.status === "lost" && deal.lostReason && (
              <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <strong>Motivo:</strong> {deal.lostReason}
              </p>
            )}
          </Card>

          {/* Cierre del ciclo: negocio ganado → contrato */}
          {deal.status === "won" && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <FileSignature className="size-3.5" /> Contrato
              </h2>
              {linkedContract ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Este negocio ya generó un contrato:
                  </p>
                  <Link
                    href={`/admin/contratos/${linkedContract.id}`}
                    className="block font-mono font-semibold text-primary hover:underline"
                  >
                    {linkedContract.number}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {money(linkedContract.amountMxn, "MXN", locale)}
                  </p>
                </div>
              ) : !deal.organization ? (
                <p className="text-xs text-muted-foreground">
                  Asigna una organización al negocio para poder generar el
                  contrato.
                </p>
              ) : !deal.organization.clientId ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    <strong>{deal.organization.name}</strong> todavía no está
                    vinculada a una cuenta del portal. Enlázala para generar el
                    contrato y que el laboratorio pueda abrir tickets.
                  </p>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link
                      href={`/admin/organizaciones/${deal.organization.id}/editar`}
                    >
                      Vincular cuenta de portal
                    </Link>
                  </Button>
                </div>
              ) : admin ? (
                <Button asChild variant="accent" size="sm" className="w-full">
                  <Link href={`/admin/contratos/nuevo?deal=${deal.id}`}>
                    <FileSignature className="size-4" /> Generar contrato
                  </Link>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Solo un administrador puede dar de alta el contrato.
                </p>
              )}
            </Card>
          )}

          {/* Etiquetas */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Tag className="size-3.5" /> Etiquetas
            </h2>
            <LabelPicker
              dealId={deal.id}
              all={labels}
              active={deal.labelLinks.map((l) => l.label.id)}
            />
          </Card>

          {/* Correo con plantilla */}
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Mail className="size-3.5" /> Correo
            </h2>
            <EmailComposer
              templates={templates}
              to={deal.contact?.email ?? null}
              vars={{
                contacto: deal.contact?.name,
                organizacion: deal.organization?.name,
                negocio: deal.title,
                valor: money(deal.valueMxn, "MXN", locale),
                yo: session?.user.name ?? session?.user.email,
              }}
            />
          </Card>

          {/*
            El costo de viaje solo aparece cuando lo hay.

            Al revés que en el contrato, donde el renglón sale siempre aunque
            esté en cero: allá es una partida del cálculo de utilidad y su
            ausencia se leería como que no se calculó. Aquí es un dato suelto, y
            una tarjeta en cero en la mayoría de los negocios —a casi ninguno se
            viaja— sería ruido en todas las fichas para servir a unas pocas.
          */}
          {costoDeViaje > 0 ? (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Plane className="size-3.5" />
                Costo de viaje
              </h2>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {mxnViatico(costoDeViaje)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Gastos de viáticos cerrados cargados a esta oportunidad.
              </p>
            </Card>
          ) : null}

          <Card className="space-y-3 p-5 text-sm">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Detalles
            </h2>

            {deal.organization && (
              <p className="flex flex-wrap items-start gap-2">
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <Link
                  href={`/admin/organizaciones/${deal.organization.id}`}
                  className="font-medium hover:text-primary"
                >
                  {deal.organization.name}
                </Link>
                {/*
                  Si ya es cliente, aquí. Vender a quien ya nos compra no es lo
                  mismo que abrir una cuenta nueva —hay historial, contrato y un
                  plazo de respuesta pactado detrás—, y desde el embudo no había
                  forma de saberlo sin salirse a buscar la ficha.
                */}
                {orgKind && (
                  <Badge className={ORG_KIND_STYLES[orgKind]}>
                    {label(ORG_KIND_LABELS, orgKind, locale)}
                  </Badge>
                )}
              </p>
            )}

            {deal.contact && (
              <div className="flex items-start gap-2">
                <User2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">{deal.contact.name}</p>
                  {deal.contact.position && (
                    <p className="text-xs text-muted-foreground">
                      {deal.contact.position}
                    </p>
                  )}
                  {deal.contact.email && (
                    <a
                      href={`mailto:${deal.contact.email}`}
                      className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Mail className="size-3" /> {deal.contact.email}
                    </a>
                  )}
                  <Telefono valor={deal.contact.phone} className="text-xs" iconClassName="size-3" />
                </div>
              </div>
            )}

            <dl className="space-y-2 border-t border-border pt-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Responsable</dt>
                <dd className="text-right font-medium">
                  {deal.owner?.name ?? deal.owner?.email ?? "Sin asignar"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cierre estimado</dt>
                <dd className="text-right font-medium">
                  {fmtDate(deal.expectedCloseDate)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Origen</dt>
                <dd className="text-right font-medium">
                  {deal.source
                    ? label(SOURCE_LABELS, deal.source, locale)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Creado</dt>
                <dd className="text-right font-medium">
                  {fmtDateTime(deal.createdAt)}
                </dd>
              </div>
              {deal.closedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cerrado</dt>
                  <dd className="text-right font-medium">
                    {fmtDateTime(deal.closedAt)}
                  </dd>
                </div>
              )}
            </dl>

            {deal.lead && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Lead de origen
                </p>
                <p className="mt-1 text-sm">{deal.lead.name}</p>
                <p className="text-xs text-muted-foreground">{deal.lead.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {deal.lead.message}
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
