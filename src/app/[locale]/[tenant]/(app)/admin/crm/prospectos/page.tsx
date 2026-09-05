import { setRequestLocale } from "next-intl/server";
import { Building2, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { getLeadOrganizations } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";
import { OrganizationsList, type OrganizationRow } from "@/components/portal/organizations-list";

/**
 * Prospectos: organizaciones sin ninguna compra registrada.
 *
 * Es la mitad de la antigua pantalla de Organizaciones que le toca a Ventas.
 * La otra mitad —los que ya compraron— vive en su propio módulo, porque lo que
 * se hace con ellos es servicio y no prospección. Detrás es la misma tabla con
 * el filtro invertido, y por eso ninguna organización puede quedarse fuera de
 * las dos listas ni salir en ambas: es la misma regla, negada (ver `ES_CLIENTE`).
 *
 * ── POR QUÉ YA NO SE LLAMA «LEADS» ────────────────────────────────────────
 *
 * Porque la palabra nombraba dos cosas distintas en el mismo menú: aquí, las
 * EMPRESAS a las que no se les ha vendido nada; y en la otra entrada, los
 * mensajes del formulario del sitio, que son PERSONAS que escribieron. Dos
 * entidades sin relación bajo un mismo rótulo, a dos renglones de distancia.
 * Ahora esto es Prospectos y aquello, Solicitudes del sitio.
 */
export default async function LeadOrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = await puedeEn("ventas", "administrar");
  // El vendedor ve su cartera Y lo que no es de nadie: prospectar lo sin
  // asignar es su trabajo. Lo que no ve es la cartera de otro vendedor.
  const orgs = await getLeadOrganizations(admin ? undefined : session!.user.id);

  const rows: OrganizationRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    taxId: o.taxId,
    industry: o.industry,
    address: o.address,
    phone: o.phone,
    ownerName: o.ownerName,
    kind: o.kind,
    hasPortal: o.hasPortal,
    contacts: o.contacts,
    openDeals: o.openDeals,
    openValue: o.openValue,
  }));

  const sinAsignar = rows.filter((r) => !r.ownerName).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prospectos</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} organización(es) sin compra registrada
            {sinAsignar > 0 && (
              <>
                {" "}
                · <span className="font-medium">{sinAsignar}</span> sin responsable,
                libres para tomar
              </>
            )}
            .
          </p>
          {/*
            LAS DOS PANTALLAS SON LA MISMA CARTERA EN DOS MOMENTOS.

            Un prospecto no se copia ni se da de alta otra vez: la misma ficha
            pasa a Clientes en cuanto hay una compra. Decirlo aquí y en Clientes
            es lo que evita que alguien busque un botón de «convertir» que no
            existe —ni debe existir: lo que convierte es ganar el negocio, no
            marcar una casilla— o que dé de alta al cliente por segunda vez.
          */}
          <p className="text-xs text-muted-foreground">
            Pasan a{" "}
            <Link href="/admin/clientes" className="text-primary hover:underline">
              Clientes
            </Link>{" "}
            solos, en cuanto se gana un negocio o se les firma un contrato. Es la
            misma ficha: no hay que darlos de alta otra vez.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link href="/admin/organizaciones/nueva">
            <Plus className="size-4" /> Nueva organización
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Building2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            No hay leads: todas las organizaciones registradas ya son clientes.
          </p>
        </Card>
      ) : (
        <OrganizationsList orgs={rows} locale={locale} />
      )}

      <p className="text-xs text-muted-foreground">
        En cuanto se le gane un negocio, la organización pasa sola a{" "}
        <Link href="/admin/clientes" className="text-primary hover:underline">
          Clientes
        </Link>{" "}
        — no hay que moverla a mano.
      </p>
    </div>
  );
}
