import { setRequestLocale } from "next-intl/server";
import { Building2, CalendarCheck, Handshake, Search, User2 } from "lucide-react";
import { globalSearch } from "@/lib/data/crm-insights";
import { DEAL_STATUS_LABELS, DEAL_STATUS_STYLES, label, money } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";

export default async function CrmSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const term = (q ?? "").trim();
  const results = term
    ? await globalSearch(term)
    : { deals: [], organizations: [], contacts: [], activities: [] };

  const total =
    results.deals.length +
    results.organizations.length +
    results.contacts.length +
    results.activities.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Búsqueda</h1>
        <p className="text-sm text-muted-foreground">
          Busca a la vez en negocios, organizaciones, contactos y actividades.
        </p>
      </div>

      {/* El formulario es GET: la búsqueda queda en la URL y se puede compartir. */}
      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={term}
          placeholder="Nombre, folio, correo, teléfono…"
          aria-label="Término de búsqueda"
          autoFocus
        />
        <Button type="submit" variant="accent">
          <Search className="size-4" /> Buscar
        </Button>
      </form>

      {term.length > 0 && term.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Escribe al menos 2 caracteres.
        </p>
      )}

      {term.length >= 2 && (
        <p className="text-sm text-muted-foreground">
          {total} resultado(s) para <strong>{term}</strong>
        </p>
      )}

      {results.deals.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Handshake className="size-4" /> Negocios
          </h2>
          <ul className="space-y-2">
            {results.deals.map((d) => (
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
                    {d.reference}
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
        </Card>
      )}

      {results.organizations.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="size-4" /> Organizaciones
          </h2>
          <ul className="space-y-2">
            {results.organizations.map((o) => (
              <li key={o.id} className="rounded-xl border border-border p-3">
                <Link
                  href={`/admin/organizaciones/${o.id}`}
                  className="text-sm font-medium hover:text-primary"
                >
                  {o.name}
                </Link>
                {o.industry && (
                  <p className="text-xs text-muted-foreground">{o.industry}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {results.contacts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <User2 className="size-4" /> Contactos
          </h2>
          <ul className="space-y-2">
            {results.contacts.map((c) => (
              <li key={c.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium">{c.name}</p>
                {c.email && (
                  <p className="text-xs text-muted-foreground">{c.email}</p>
                )}
                {c.organizationId && (
                  <Link
                    href={`/admin/organizaciones/${c.organizationId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver organización
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {results.activities.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarCheck className="size-4" /> Actividades
          </h2>
          <ul className="space-y-2">
            {results.activities.map((a) => (
              <li key={a.id} className="rounded-xl border border-border p-3">
                <p
                  className={`text-sm ${a.done ? "text-muted-foreground line-through" : "font-medium"}`}
                >
                  {a.subject}
                </p>
                {a.dealId && (
                  <Link
                    href={`/admin/crm/negocios/${a.dealId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver negocio
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {term.length >= 2 && total === 0 && (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Search className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Sin coincidencias para <strong>{term}</strong>.
          </p>
        </Card>
      )}
    </div>
  );
}
