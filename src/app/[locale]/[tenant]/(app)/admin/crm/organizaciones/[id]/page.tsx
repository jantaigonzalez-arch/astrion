import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CalendarClock,
  FileSignature,
  Globe,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Ticket,
  User2,
} from "lucide-react";
import {
  getOrganizationById,
  getOrganizationPortalData,
} from "@/lib/data/crm";
import {
  ACTIVITY_LABELS,
  ACTIVITY_STYLES,
  DEAL_STATUS_LABELS,
  DEAL_STATUS_STYLES,
  label,
  money,
} from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import {
  ActivityQuickForm,
  ActivityToggle,
  NoteForm,
} from "@/components/portal/crm/deal-panels";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const org = await getOrganizationById(id);
  if (!org) notFound();

  // Todo lo que ya existe en el portal para este laboratorio.
  const portal = await getOrganizationPortalData(org.clientId);

  const intl = locale === "en" ? "en-US" : "es-MX";
  const fmtDateTime = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }) : "—";

  const openDeals = org.deals.filter((d) => d.status === "open");
  const openValue = openDeals.reduce((a, d) => a + Number(d.valueMxn ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/crm/organizaciones">
            <ArrowLeft className="size-4" /> Organizaciones
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            {org.client && (
              <Badge className="bg-success/15 text-success ring-success/25">
                Cliente del portal
              </Badge>
            )}
          </div>
          {org.industry && (
            <p className="text-sm text-muted-foreground">{org.industry}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/crm/organizaciones/${org.id}/editar`}>
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
          {org.clientId ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Relación como cliente
              </h2>

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
                Esta organización aún no está vinculada a una cuenta del portal.
                Al vincularla verás aquí sus <strong>contratos</strong>,{" "}
                <strong>equipos</strong> y <strong>tickets</strong>, y podrás
                generar contratos desde los negocios ganados.
              </p>
              <Button asChild variant="accent" size="sm" className="mt-4">
                <Link href={`/admin/crm/organizaciones/${org.id}/editar`}>
                  <Link2 className="size-4" /> Vincular cuenta de portal
                </Link>
              </Button>
            </Card>
          )}

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
            {org.phone && (
              <a
                href={`tel:${org.phone}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-primary"
              >
                <Phone className="size-4" /> {org.phone}
              </a>
            )}
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
            {org.address && (
              <p className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" /> {org.address}
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
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                      >
                        <Phone className="size-3" /> {c.phone}
                      </a>
                    )}
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
