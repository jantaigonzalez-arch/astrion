import { setRequestLocale } from "next-intl/server";
import { Boxes, Link2, Pencil, Unlink, UserPlus } from "lucide-react";
import { getUsers } from "@/lib/data/tickets";
import {
  CAMPOS_ORDEN_MIEMBROS,
  ORDEN_MIEMBROS_DEFECTO,
  contarMiembros,
} from "@/lib/data/people";
import { parseFiltro, parseOrden, queryLimpia } from "@/lib/listado";
import { ResumenFiltros, ThOrden } from "@/components/portal/listado-controles";
import { FiltroColumna } from "@/components/portal/filtro-columna";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { requireTenant } from "@/lib/tenancy/context";
import type { MembershipRole } from "@/lib/db/platform";

const ESTADOS_MIEMBRO = ["activos", "bajas"] as const;
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
  searchParams: Promise<{
    orden?: string;
    dir?: string;
    rol?: string;
    estado?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const isAdmin = await puedeEn("configuracion", "administrar");
  const sp = await searchParams;
  const orden = parseOrden(sp, CAMPOS_ORDEN_MIEMBROS, ORDEN_MIEMBROS_DEFECTO);
  /*
    `ASSIGNABLE_ROLES` como lista blanca y no todos los roles: `owner` queda
    fuera a propósito en toda esta pantalla —su cuenta no se administra desde
    aquí— y ofrecerlo como filtro sería el único sitio donde asoma.
  */
  const filtros = {
    rol: parseFiltro(sp.rol, ASSIGNABLE_ROLES) as MembershipRole | undefined,
    estado: parseFiltro(sp.estado, ESTADOS_MIEMBRO),
  };
  const query = queryLimpia({ rol: filtros.rol, estado: filtros.estado });

  const ctx = await requireTenant();
  const [users, orgsByClient, conteos] = await Promise.all([
    getUsers(orden, {
      rol: filtros.rol,
      activo: filtros.estado ? filtros.estado === "activos" : undefined,
    }),
    getOrganizationsByClient(),
    contarMiembros(ctx.tenantId),
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

      <Card className="overflow-hidden p-0">
        <ResumenFiltros
          basePath={BASE}
          query={query}
          puestos={[
            filtros.rol && {
              clave: "rol",
              titulo: "Rol",
              valor: ROLE_LABELS[filtros.rol],
            },
            filtros.estado && {
              clave: "estado",
              titulo: "Estado",
              valor: filtros.estado === "activos" ? "Activos" : "Bajas",
            },
          ].filter((x): x is { clave: string; titulo: string; valor: string } =>
            Boolean(x),
          )}
        />
        <div className="overflow-x-auto">
          <table data-tabla="usuarios" className="tabla-erp w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThOrden campo="nombre" actual={orden} basePath={BASE} query={query}>
                  Nombre
                </ThOrden>
                <ThOrden campo="correo" actual={orden} basePath={BASE} query={query}>
                  Correo
                </ThOrden>
                <ThOrden campo="empresa" actual={orden} basePath={BASE} query={query}>
                  Empresa
                </ThOrden>
                {/* Ordena por el enum de Postgres: dueño, administrador,
                    agente, vendedor, cliente. Agrupa por alcance, que es lo que
                    se busca al ordenar por rol. Ver `ORDEN_MIEMBROS`. */}
                <ThOrden
                  campo="rol"
                  actual={orden}
                  basePath={BASE}
                  query={query}
                  filtro={
                    <FiltroColumna
                      titulo="Rol"
                      clave="rol"
                      activo={filtros.rol}
                      basePath={BASE}
                      query={query}
                      opciones={[
                        { label: "Todos" },
                        ...ASSIGNABLE_ROLES.map((r) => ({
                          valor: r,
                          label: ROLE_LABELS[r],
                          n: conteos.rol.find((c) => c.k === r)?.n ?? 0,
                        })),
                      ]}
                    />
                  }
                >
                  Rol
                </ThOrden>
                <th className="px-4 py-3 font-medium">CRM</th>
                <ThOrden
                  basePath={BASE}
                  query={query}
                  filtro={
                    <FiltroColumna
                      titulo="Estado"
                      clave="estado"
                      activo={filtros.estado}
                      basePath={BASE}
                      query={query}
                      opciones={[
                        { label: "Todos" },
                        { valor: "activos", label: "Activos", n: conteos.activos },
                        { valor: "bajas", label: "Bajas", n: conteos.bajas },
                      ]}
                    />
                  }
                >
                  Activo
                </ThOrden>
                <ThOrden campo="alta" actual={orden} basePath={BASE} query={query} inicial="desc">
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
                        href={`/admin/organizaciones/${orgsByClient.get(u.id)!.id}`}
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
