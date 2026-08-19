import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Boxes, FileSignature, Pencil, UserRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { countContracts, getContracts } from "@/lib/data/contracts";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";

function money(v: string | null, currency: "MXN" | "USD", locale: string) {
  if (!v) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export default async function ContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; por?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = isAdminRole(await currentRole());
  // El vendedor ve solo sus contratos; el admin, todos.
  const deQuien = admin ? undefined : session!.user.id;
  const pageParams = parsePage(await searchParams);

  // El total sale de su propia consulta porque el encabezado dice cuántos hay
  // EN TOTAL, no cuántos caben en la página. Van en paralelo.
  const [list, total] = await Promise.all([
    getContracts(deQuien, undefined, {
      limit: pageParams.perPage,
      offset: pageParams.offset,
    }),
    countContracts(deQuien),
  ]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString(locale === "en" ? "en-US" : "es-MX") : "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contratos</h1>
          <p className="text-sm text-muted-foreground">
            {admin
              ? `${total} contrato(s) registrados.`
              : `${total} contrato(s) a tu cargo.`}
          </p>
        </div>
        {admin && (
          <Button asChild variant="accent">
            <Link href="/admin/contratos/nuevo">
              <FileSignature className="size-4" /> Nuevo contrato
            </Link>
          </Button>
        )}
      </div>

      {total === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <FileSignature className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay contratos registrados.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((c) => (
            <Card
              key={c.id}
              className="p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/contratos/${c.id}`}
                      className="font-mono text-sm font-semibold text-primary hover:underline"
                    >
                      {c.number}
                    </Link>
                    <Badge className="bg-primary/10 text-primary ring-primary/20">
                      {c.client.company ?? c.client.name ?? c.client.email}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="size-3.5" />
                      {c.salesRep?.name ?? c.salesRep?.email ?? "Sin vendedor"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Boxes className="size-3.5" />
                      {c.equipmentLinks.length} equipo(s)
                    </span>
                    <span>
                      Vigencia: {fmtDate(c.startDate)} → {fmtDate(c.endDate)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">
                    {money(c.amountMxn, "MXN", locale)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {money(c.amountUsd, "USD", locale)}
                  </div>
                </div>
              </div>

              {c.equipmentLinks.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  {c.equipmentLinks.map((l) => (
                    <li
                      key={l.equipmentId}
                      className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs"
                    >
                      {l.equipment.brand} {l.equipment.name}
                      {l.equipment.model ? ` · ${l.equipment.model}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {c.notes && (
                <p className="mt-3 text-sm text-muted-foreground">{c.notes}</p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                {admin && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/admin/contratos/${c.id}/editar`}>
                      <Pencil className="size-3.5" /> Editar
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/contratos/${c.id}`}>
                    Ver detalle <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
          {/* Estos contratos son tarjetas y no filas de tabla, así que el
              paginador va suelto al final de la pila con su propio borde
              superior — el mismo control, sin fingir que hay una tabla. */}
          <Pagination
            {...pageParams}
            total={total}
            basePath="/admin/contratos"
            className="rounded-lg border border-border bg-card"
          />
        </div>
      )}
    </div>
  );
}
