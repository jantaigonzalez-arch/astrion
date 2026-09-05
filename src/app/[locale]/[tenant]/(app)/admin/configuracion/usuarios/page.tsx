import { setRequestLocale } from "next-intl/server";
import { Boxes, Link2, Pencil, Unlink, UserPlus } from "lucide-react";
import { getUsers } from "@/lib/data/tickets";
import {
  CAMPOS_ORDEN_MIEMBROS,
  ORDEN_MIEMBROS_DEFECTO,
} from "@/lib/data/people";
import { parseOrden } from "@/lib/listado";
import { ThOrden } from "@/components/portal/listado-controles";
import { getOrganizationsByClient } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";
import { ROLE_LABELS } from "@/lib/roles";

const ROLE_STYLES: Record<string, string> = {
  owner: "bg-destructive/12 text-destructive ring-destructive/25",
  admin: "bg-destructive/12 text-destructive ring-destructive/25",
  agent: "bg-signal/15 text-signal-bright ring-signal/25",
  client: "bg-primary/10 text-primary ring-primary/20",
  sales: "bg-warning/15 text-warning ring-warning/25",
};

const BASE = "/admin/configuracion/usuarios";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orden?: string; dir?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const isAdmin = await puedeEn("configuracion", "administrar");
  const orden = parseOrden(
    await searchParams,
    CAMPOS_ORDEN_MIEMBROS,
    ORDEN_MIEMBROS_DEFECTO,
  );
  const [users, orgsByClient] = await Promise.all([
    getUsers(orden),
    getOrganizationsByClient(),
  ]);
  const fmt = (d: Date | string) =>
    new Date(d).toLocaleDateString(locale === "en" ? "en-US" : "es-MX");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground">{users.length} cuentas registradas.</p>
        </div>
        {isAdmin && (
          <Button asChild variant="accent">
            <Link href="/admin/configuracion/usuarios/new">
              <UserPlus className="size-4" /> Nueva cuenta
            </Link>
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tabla-erp w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThOrden campo="nombre" actual={orden} basePath={BASE}>
                  Nombre
                </ThOrden>
                <ThOrden campo="correo" actual={orden} basePath={BASE}>
                  Correo
                </ThOrden>
                <ThOrden campo="empresa" actual={orden} basePath={BASE}>
                  Empresa
                </ThOrden>
                {/* Ordena por el enum de Postgres: dueño, administrador,
                    agente, vendedor, cliente. Agrupa por alcance, que es lo que
                    se busca al ordenar por rol. Ver `ORDEN_MIEMBROS`. */}
                <ThOrden campo="rol" actual={orden} basePath={BASE}>
                  Rol
                </ThOrden>
                <th className="px-4 py-3 font-medium">CRM</th>
                <th className="px-4 py-3 font-medium">Activo</th>
                <ThOrden campo="alta" actual={orden} basePath={BASE} inicial="desc">
                  Alta
                </ThOrden>
                <th className="px-4 py-3 font-medium">Equipos</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{u.name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={ROLE_STYLES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {u.role !== "client" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : orgsByClient.get(u.id) ? (
                      <Link
                        href={`/admin/crm/organizaciones/${orgsByClient.get(u.id)!.id}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Link2 className="size-3.5" />
                        {orgsByClient.get(u.id)!.name}
                      </Link>
                    ) : (
                      <Link
                        href={`/admin/configuracion/usuarios/${u.id}/editar`}
                        className="inline-flex items-center gap-1 text-xs text-warning hover:underline"
                        title="Esta cuenta no está enlazada a ninguna organización del CRM"
                      >
                        <Unlink className="size-3.5" /> Sin vincular
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {!u.memberActive
                      ? "Baja"
                      : u.accountActive
                        ? "Sí"
                        : "Cuenta deshabilitada"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmt(u.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link
                      href={`/admin/equipos/${u.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <Boxes className="size-3.5" /> Gestionar
                    </Link>
                  </td>
                  {isAdmin && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/admin/configuracion/usuarios/${u.id}/editar`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Pencil className="size-3.5" /> Editar
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
