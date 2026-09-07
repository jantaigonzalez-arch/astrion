import { setRequestLocale } from "next-intl/server";
import { ArrowRight, Boxes, FileSignature, Pencil, UserRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { CAMPOS_ORDEN_CONTRATOS, ORDEN_CONTRATOS_DEFECTO, VIGENCIAS, conteosContratos, countContracts, getContracts } from "@/lib/data/contracts";
import { parsePage } from "@/lib/pagination";
import { parseFiltro, parseOrden, queryLimpia } from "@/lib/listado";
import { Pagination } from "@/components/portal/pagination";
import { BarraFiltros, FiltroFichas, OrdenFichas } from "@/components/portal/listado-controles";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";
import { BotonDescargar } from "@/components/portal/boton-descargar";

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
  searchParams: Promise<{
    page?: string;
    por?: string;
    orden?: string;
    dir?: string;
    vigencia?: string;
    vendedor?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = await puedeEn("clientes", "administrar");
  // El vendedor ve solo sus contratos; el admin, todos.
  const deQuien = admin ? undefined : session!.user.id;
  const sp = await searchParams;
  const pageParams = parsePage(sp);

  const orden = parseOrden(sp, CAMPOS_ORDEN_CONTRATOS, ORDEN_CONTRATOS_DEFECTO);
  const filtros = {
    vigencia: parseFiltro(sp.vigencia, VIGENCIAS),
    // El filtro por vendedor solo tiene sentido para quien ve los de todos: a
    // un vendedor ya se le acotó la lista a los suyos, y ofrecerle filtrar por
    // otro sería ofrecerle una lista vacía.
    vendedor: admin ? sp.vendedor : undefined,
  };
  const query = queryLimpia({
    vigencia: filtros.vigencia,
    vendedor: filtros.vendedor,
    orden: orden.campo,
    dir: orden.dir,
    por: sp.por,
  });

  // El total sale de su propia consulta porque el encabezado dice cuántos hay
  // EN TOTAL, no cuántos caben en la página. Van en paralelo.
  const [list, total, conteos, totalSinFiltros] = await Promise.all([
    getContracts(
      deQuien,
      undefined,
      { limit: pageParams.perPage, offset: pageParams.offset },
      orden,
      filtros,
    ),
    countContracts(deQuien, undefined, filtros),
    conteosContratos(deQuien, filtros),
    countContracts(deQuien),
  ]);

  const hayFiltros =
    Boolean(filtros.vigencia || filtros.vendedor) ||
    orden.campo !== ORDEN_CONTRATOS_DEFECTO.campo ||
    orden.dir !== ORDEN_CONTRATOS_DEFECTO.dir;

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

        <BotonDescargar dataset="contratos" query={query} />
      </div>

      {totalSinFiltros > 0 && (
        <BarraFiltros
          hayFiltros={hayFiltros}
          basePath="/admin/contratos"
          className="rounded-lg border border-border bg-card"
        >
          <FiltroFichas
            titulo="Vigencia"
            clave="vigencia"
            activo={filtros.vigencia}
            basePath="/admin/contratos"
            query={query}
            opciones={[
              { label: "Todos" },
              { valor: "vigente", label: "Vigentes", n: conteos.vigencia.get("vigente") ?? 0 },
              {
                valor: "por-vencer",
                label: "Por vencer (60 d)",
                n: conteos.vigencia.get("por-vencer") ?? 0,
              },
              { valor: "vencido", label: "Vencidos", n: conteos.vigencia.get("vencido") ?? 0 },
            ]}
          />
          {admin && (
            <FiltroFichas
              titulo="Vendedor"
              clave="vendedor"
              activo={filtros.vendedor}
              basePath="/admin/contratos"
              query={query}
              opciones={[
                { label: "Todos" },
                ...conteos.vendedor.map((v) => ({
                  valor: v.id,
                  label: v.id === "sin" ? v.nombre : v.nombre.split(" ")[0],
                  n: v.n,
                })),
              ]}
            />
          )}
          <OrdenFichas
            actual={orden}
            basePath="/admin/contratos"
            query={query}
            campos={[
              { campo: "numero", label: "Número" },
              { campo: "monto", label: "Monto", inicial: "desc" },
              { campo: "inicio", label: "Inicio", inicial: "desc" },
              { campo: "fin", label: "Vencimiento", inicial: "asc" },
              { campo: "creado", label: "Alta", inicial: "desc" },
            ]}
          />
        </BarraFiltros>
      )}

      {total === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <FileSignature className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {/*
              Dos vacíos distintos que antes decían lo mismo. «No hay ninguno»
              se resuelve dando de alta un contrato; «no hay con estos filtros»
              se resuelve quitándolos, y confundirlos manda a la persona al sitio
              equivocado.
            */}
            {hayFiltros
              ? "Ningún contrato coincide con estos filtros."
              : "Aún no hay contratos registrados."}
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
            query={query}
            className="rounded-lg border border-border bg-card"
          />
        </div>
      )}
    </div>
  );
}
