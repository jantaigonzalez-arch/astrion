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
import { ASSIGNABLE_ROLES, GRUPOS_USUARIO, rolesDeGrupo } from "@/lib/roles";
import { requireTenant } from "@/lib/tenancy/context";
import type { MembershipRole } from "@/lib/db/platform";

const ESTADOS_MIEMBRO = ["activos", "bajas"] as const;
import { getOrganizationsByClient } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";
import { redirectInTenant } from "@/lib/nav-server";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";

const ROLE_STYLES: Record<string, string> = {
  owner: "bg-destructive/12 text-destructive ring-destructive/25",
  admin: "bg-destructive/12 text-destructive ring-destructive/25",
  agent: "bg-signal/15 text-signal-bright ring-signal/25",
  client: "bg-primary/10 text-primary ring-primary/20",
  sales: "bg-warning/15 text-warning ring-warning/25",
};

const BASE = "/admin/configuracion/usuarios";

const GRUPO_TITULO = {
  internos: "Equipo interno",
  clientes: "Clientes del portal",
} as const;

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
    grupo?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  /*
    GUARDIA PROPIO, y esta pantalla no tenía ninguno.

    `isAdmin` existía solo para decidir qué botones pintar; quien no podía estar
    aquí lo paraba el layout del área, que exigía `configuracion: administrar`
    para todo. Al abrirse el área a quien administra VIÁTICOS —para que General
    llegue a su pestaña— ese listón dejó de proteger el PADRÓN DE USUARIOS, que
    es de lo más sensible que hay aquí dentro: correos, roles y el enlace con la
    organización de cada cuenta.

    Se descubrió probándolo con una sesión de General de verdad, no leyendo el
    archivo: `puedeEn` estaba escrito en esta página, así que a simple vista
    parecía guardada. Calculaba un permiso y no lo hacía cumplir.
  */
  const isAdmin = await puedeEn("configuracion", "administrar");
  if (!isAdmin) {
    await redirectInTenant("/dashboard", locale);
  }
  const sp = await searchParams;
  const orden = parseOrden(sp, CAMPOS_ORDEN_MIEMBROS, ORDEN_MIEMBROS_DEFECTO);
  /*
    DOS PADRONES EN PANTALLA, UNA SOLA TABLA EN LA BASE.

    El equipo que trabaja aquí y los clientes que entran al portal salían
    revueltos en una lista: los agentes, entre decenas de laboratorios. Se
    parten por `role` sobre la misma consulta —ver `GRUPOS_USUARIO`—, así que
    cambiar de pestaña es un filtro más, no otra tabla ni otro viaje.

    Se abre en el equipo interno: es Configuración, y lo que se viene a hacer
    aquí es dar de alta o de baja a alguien de la casa. Los clientes también se
    ven desde su organización.
  */
  const grupo = parseFiltro(sp.grupo, GRUPOS_USUARIO) ?? "internos";
  const esClientes = grupo === "clientes";
  /*
    `ASSIGNABLE_ROLES` como lista blanca y no todos los roles: `owner` queda
    fuera a propósito en toda esta pantalla —su cuenta no se administra desde
    aquí— y ofrecerlo como filtro sería el único sitio donde asoma. Y solo los
    del padrón abierto: en el de clientes no hay nada que filtrar por rol.
  */
  const rolesDelGrupo = ASSIGNABLE_ROLES.filter((r) => rolesDeGrupo(grupo).includes(r));
  const filtros = {
    rol: parseFiltro(sp.rol, rolesDelGrupo) as MembershipRole | undefined,
    estado: parseFiltro(sp.estado, ESTADOS_MIEMBRO),
  };
  // `grupo` va en la query de TODO lo que enlaza desde aquí —orden, filtros,
  // resumen—, o pulsar una columna devolvería a la otra pestaña.
  const query = queryLimpia({
    grupo: esClientes ? grupo : undefined,
    rol: filtros.rol,
    estado: filtros.estado,
  });

  const ctx = await requireTenant();
  const [users, orgsByClient, conteos] = await Promise.all([
    getUsers(orden, {
      roles: rolesDeGrupo(grupo),
      rol: filtros.rol,
      activo: filtros.estado ? filtros.estado === "activos" : undefined,
    }),
    // El enlace con el CRM solo se pinta en el padrón de clientes.
    esClientes ? getOrganizationsByClient() : Promise.resolve(null),
    contarMiembros(ctx.tenantId),
  ]);
  const fmt = (d: Date | string) =>
    new Date(d).toLocaleDateString(locale === "en" ? "en-US" : "es-MX");
  const delGrupo = conteos.grupo[grupo];

  // Cambiar de pestaña suelta el filtro de rol —el de un padrón no existe en el
  // otro— pero conserva el de estado y el orden.
  const enlaceGrupo = (g: (typeof GRUPOS_USUARIO)[number]) => {
    const p = new URLSearchParams(
      queryLimpia({
        grupo: g === "clientes" ? g : undefined,
        estado: filtros.estado,
        orden: sp.orden,
        dir: sp.dir,
      }),
    ).toString();
    return p ? `${BASE}?${p}` : BASE;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            {esClientes
              ? `${delGrupo.total} cuentas de clientes con acceso al portal.`
              : `${delGrupo.total} personas en el equipo interno.`}
          </p>
        </div>
        {isAdmin && (
          <Button asChild variant="accent">
            {/* El alta abre con el rol del padrón en el que se estaba. */}
            <Link href={`/admin/configuracion/usuarios/new?rol=${esClientes ? "client" : "agent"}`}>
              <UserPlus className="size-4" /> {esClientes ? "Nuevo cliente" : "Nueva persona"}
            </Link>
          </Button>
        )}
      </div>

      <nav aria-label="Padrón" className="flex flex-wrap gap-2">
        {GRUPOS_USUARIO.map((g) => (
          <Link
            key={g}
            href={enlaceGrupo(g)}
            aria-current={g === grupo ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              g === grupo
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {GRUPO_TITULO[g]}
            <span className="ml-1.5 tabular-nums opacity-75">{conteos.grupo[g].total}</span>
          </Link>
        ))}
      </nav>

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
          {/*
            Un `data-tabla` por padrón: tienen columnas distintas, y los anchos
            que alguien guarde en uno no deben caer sobre las del otro.
          */}
          <table data-tabla={`usuarios-${grupo}`} className="tabla-erp w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThOrden campo="nombre" actual={orden} basePath={BASE} query={query}>
                  Nombre
                </ThOrden>
                <ThOrden campo="correo" actual={orden} basePath={BASE} query={query}>
                  Correo
                </ThOrden>
                {esClientes && (
                  <ThOrden campo="empresa" actual={orden} basePath={BASE} query={query}>
                    Empresa
                  </ThOrden>
                )}
                {/* Ordena por el enum de Postgres: dueño, administrador,
                    agente, vendedor, cliente. Agrupa por alcance, que es lo que
                    se busca al ordenar por rol. Ver `ORDEN_MIEMBROS`.
                    Solo en el equipo interno: en el de clientes todos son
                    cliente, y la columna diría lo mismo 30 veces. */}
                {!esClientes && (
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
                          ...rolesDelGrupo.map((r) => ({
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
                )}
                {esClientes && <th className="px-4 py-3 font-medium">CRM</th>}
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
                        { valor: "activos", label: "Activos", n: delGrupo.activos },
                        { valor: "bajas", label: "Bajas", n: delGrupo.bajas },
                      ]}
                    />
                  }
                >
                  Activo
                </ThOrden>
                <ThOrden campo="alta" actual={orden} basePath={BASE} query={query} inicial="desc">
                  Alta
                </ThOrden>
                {esClientes && <th className="px-4 py-3 font-medium">Equipos</th>}
                {isAdmin && <th className="px-4 py-3 font-medium">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-secondary/40">
                  {/*
                    El nombre SE PARTE y no se corta: aquí es lo que identifica la
                    fila, y hay nombres de 64 caracteres. Sin `whitespace-nowrap`
                    —con él se salía de la celda y tapaba el correo—, y con piso
                    de 26ch, que salió de medir: como el correo y la empresa no se
                    parten, la tabla le deja a esta columna solo su mínimo, y sin
                    piso el nombre más largo se apilaba en 6 renglones (18ch, 163
                    px); con 26ch, en 4 y el resto en 1–3.
                  */}
                  <td className="min-w-[26ch] px-4 py-3 font-medium">{u.name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.email}</td>
                  {esClientes && (
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.company ?? "—"}</td>
                  )}
                  {!esClientes && (
                    <td className="px-4 py-3">
                      <Badge className={ROLE_STYLES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </td>
                  )}
                  {esClientes && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {orgsByClient?.get(u.id) ? (
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
                  )}
                  <td className="px-4 py-3 text-muted-foreground">
                    {!u.memberActive
                      ? "Baja"
                      : u.accountActive
                        ? "Sí"
                        : "Cuenta deshabilitada"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmt(u.createdAt)}</td>
                  {/* Los equipos son de los laboratorios: nadie del equipo
                      interno tiene inventario propio que gestionar. */}
                  {esClientes && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/admin/equipos/${u.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Boxes className="size-3.5" /> Gestionar
                      </Link>
                    </td>
                  )}
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
        {/* Fuera de la tabla y no en una fila con `colSpan`: esa fila sería la
            primera columna, con su techo de 34ch, y el aviso saldría cortado. */}
        {users.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {filtros.rol || filtros.estado
              ? "Nadie cumple esos filtros."
              : esClientes
                ? "Todavía ningún cliente tiene acceso al portal."
                : "Todavía no hay nadie más en el equipo."}
          </p>
        )}
      </Card>
    </div>
  );
}
