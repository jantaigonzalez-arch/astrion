"use client";

import {
  LayoutDashboard,
  Ticket,
  PlusCircle,
  Inbox,
  Mail,
  BarChart3,
  ClipboardList,
  ClipboardPlus,
  Brain,
  Building2,
  CalendarCheck,
  FileSignature,
  KanbanSquare,
  Package,
  Receipt,
  Settings,
  Target,
  TrendingUp,
  Users2,
  type LucideIcon,
  ShoppingCart,
  Truck,
  Wallet,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { Link, usePathname } from "@/lib/nav";
import { TenantMark, type TenantBrand } from "@/components/portal/tenant-mark";
import { PoweredByAstraion } from "@/components/portal/powered-by";
import type { MembershipRole } from "@/lib/db/platform";
import { isAdminRole, ROLE_LABELS } from "@/lib/roles";
import { navFor, type NavItem, type TableroItem } from "@/lib/portal/menu";
import { cn } from "@/lib/utils";

/**
 * Qué pantallas ve cada rol vive en `lib/portal/menu.ts`, no aquí.
 *
 * Este archivo es `use client`, y de ese menú sale una decisión de permiso —qué
 * tableros se ven— que el servidor también tiene que poder tomar. Ver la
 * cabecera de ese archivo.
 */
export type { TableroItem };

/**
 * El icono de cada renglón, por su dirección.
 *
 * Vive aquí y no en el modelo porque es lo ÚNICO del menú que es dibujo: el
 * modelo decide quién ve qué y tiene que poder correr fuera de un navegador,
 * y `lucide-react` no puede. La tabla se busca por `href`, que es la clave que
 * el modelo ya usa para todo lo demás, así que añadir una pantalla allí y
 * olvidarse de aquí no rompe nada — cae en el icono de reserva.
 */
const ICONO: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/tickets": Ticket,
  "/tickets/new": PlusCircle,
  "/admin/tickets": Inbox,
  "/admin/tickets/new": ClipboardPlus,
  "/admin/crm": KanbanSquare,
  "/admin/pedidos": Receipt,
  "/admin/leads": Mail,
  "/admin/crm/leads": Building2,
  "/admin/crm/contactos": Users2,
  "/admin/crm/actividades": CalendarCheck,
  "/admin/clientes": Building2,
  "/admin/contratos": FileSignature,
  "/admin/refacciones": Package,
  "/admin/compras/requisiciones": ClipboardList,
  "/admin/compras": ShoppingCart,
  "/admin/compras/proveedores": Truck,
  "/admin/compras/cuentas-por-pagar": Wallet,
  "/admin/rentabilidad": TrendingUp,
  "/admin/crm/informes": BarChart3,
  "/admin/crm/objetivos": Target,
  "/admin/inteligencia": Brain,
  "/admin/dashboard/nuevo": PlusCircle,
};

/**
 * El icono de los siete de fábrica es el DE SU MÓDULO, no uno de tablero.
 *
 * Plegada, la barra es una tira de iconos sin texto, y siete tableros con el
 * mismo icono de rejilla serían siete renglones indistinguibles — el problema
 * que este menú ya evita a mano entre el levantamiento y la requisición. Con el
 * icono del módulo, el tablero de Compras se reconoce por lo mismo que Compras.
 *
 * Se busca por SLUG, que en los siete de siempre es el id de su módulo. Un
 * tablero creado a mano no está en este mapa y cae en la rejilla genérica, que
 * es lo correcto: no es de ningún módulo en particular.
 */
const ICONO_DE_MODULO: Record<string, LucideIcon> = {
  servicio: Inbox,
  ventas: KanbanSquare,
  clientes: Building2,
  refacciones: Package,
  compras: ShoppingCart,
  pagos: Wallet,
  rentabilidad: TrendingUp,
};

function iconoDe(item: NavItem): LucideIcon {
  const directo = ICONO[item.href];
  if (directo) return directo;
  const slug = item.href.startsWith("/admin/dashboard/")
    ? item.href.slice("/admin/dashboard/".length)
    : null;
  return (slug && ICONO_DE_MODULO[slug]) || LayoutDashboard;
}

/** Cookie del estado plegado. La lee el layout para que no haya parpadeo. */
export const SIDEBAR_COOKIE = "evo_sidebar";

/**
 * Barra lateral del portal, plegable a un riel de iconos.
 *
 * El estado viaja en una cookie y no en `localStorage` a propósito. Con
 * `localStorage` hay que leerlo después de montar, así que el servidor pinta
 * siempre la barra ancha y el navegador la encoge un instante después: en cada
 * carga completa se ve el salto. La cookie la lee el layout en el servidor y la
 * barra nace ya del ancho correcto.
 *
 * Plegada, el nombre de cada opción va en `title` y no en un globito de CSS: el
 * `<nav>` tiene scroll vertical, y un elemento posicionado fuera de su ancho
 * queda recortado por ese mismo contenedor. El globito se vería a medias justo
 * en el estado donde es la única forma de saber qué es cada icono.
 *
 * El tirador para plegar sí puede salirse: cuelga del `<aside>`, que no recorta.
 */
export function Sidebar({
  role,
  brand,
  defaultCollapsed = false,
  tableros = [],
  deVisita = false,
}: {
  role: MembershipRole;
  brand: TenantBrand;
  defaultCollapsed?: boolean;
  tableros?: TableroItem[];
  /** Personal de Astraion visitando esta empresa. Ver `menuDelRol`. */
  deVisita?: boolean;
}) {
  const pathname = usePathname();
  const groups = navFor(role, tableros, deVisita);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  /**
   * Asomar: plegada, acercar el cursor despliega la barra encima del contenido
   * y al alejarlo vuelve al riel.
   *
   * Es estado de React y no `hover:w-64` de CSS porque las etiquetas no están
   * en el DOM cuando la barra está plegada: ensanchar la caja con CSS habría
   * mostrado una barra ancha llena de iconos sueltos. Con esto, el mismo
   * `wide` gobierna el ancho Y el texto, que es lo que hace que despleguen
   * juntos.
   */
  const [peek, setPeek] = useState(false);
  const wide = !collapsed || peek;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Un año: es una preferencia de cómo se trabaja, no un dato de sesión.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  // Se marca activo solo el enlace más específico que coincide con la ruta,
  // para que "/admin/crm" no quede encendido junto a "/admin/crm/contactos".
  const bestMatch = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  const fila = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors",
      wide ? "px-3" : "justify-center px-2",
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    );

  return (
    // El <aside> es solo el hueco que la barra ocupa en el layout, y su ancho
    // NO cambia al asomar: si cambiara, el contenido de la página se correría
    // hacia la derecha cada vez que el cursor roza el menú. El panel de adentro
    // es el que se ensancha, flotando por encima.
    <aside
      className={cn(
        "no-print relative hidden shrink-0 transition-[width] duration-200 lg:block",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/*
        El cursor se escucha AQUÍ y no en el <aside>: asomada, el panel mide
        256 px y el hueco sigue midiendo 64. Con los manejadores en el hueco,
        mover el mouse hacia adentro del menú lo sacaba del elemento que
        escuchaba y la barra se cerraba sola — justo al ir a hacer clic.
      */}
      <div
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        // Tabular hacia adentro también despliega: quien navega con teclado no
        // puede "acercar el cursor", y un riel de iconos sin nombre no se recorre.
        onFocus={() => collapsed && setPeek(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPeek(false);
        }}
        className={cn(
          "group/rail absolute inset-y-0 left-0 flex flex-col border-r border-border transition-[width] duration-200",
          wide ? "w-64" : "w-16",
          // Asomada flota: fondo opaco y sombra, para que se lea encima de la
          // página en vez de mezclarse con ella.
          peek && collapsed ? "z-40 bg-card shadow-xl" : "bg-card/50",
        )}
      >
        {/*
          Tirador en el borde, no un renglón al pie.
          Al pie quedaba al final de una barra que llega abajo de todo, y ahí
          compite con el indicador de desarrollo de Next, que lo tapa a medias.
          Nada señalaba que la barra se pudiera plegar.

          Aparece al acercarse a la barra y se queda fijo con el foco del teclado:
          oculto siempre sería inalcanzable sin mouse.
        */}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expandir menú" : "Contraer menú"}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          aria-expanded={!collapsed}
          className={cn(
            // Alineado con la banda del encabezado: es donde el ojo entra a la barra.
            "absolute -right-3 top-5 z-30 flex size-6 items-center justify-center rounded-full",
            "border border-border bg-card text-muted-foreground shadow-sm",
            "opacity-0 transition-all duration-150",
            "hover:border-primary hover:bg-primary hover:text-primary-foreground",
            "group-hover/rail:opacity-100 focus-visible:opacity-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          )}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </button>
        <div
          className={cn(
            "flex h-16 min-w-0 items-center border-b border-border",
            // Plegada el riel mide 64 px y el logo ya viene en caja de 32.
            // Desplegada se deja algo más de aire a la derecha que a la
            // izquierda: ahí asoma el botón de plegar, y un nombre que llega
            // hasta el borde lo toca.
            wide ? "pl-6 pr-5" : "justify-center px-2",
          )}
        >
          {/* `flex` y no solo `min-w-0`: el enlace es un <a>, o sea inline, y
              sobre un elemento inline `min-w-0` no significa nada. Sin esto la
              cadena de contención se rompe aquí y el nombre de la empresa se
              sale del riel por más `truncate` que lleve dentro. */}
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center">
            <TenantMark brand={brand} showWord={wide} compact={!wide} />
          </Link>
        </div>

        <nav className={cn("flex-1 overflow-y-auto p-4", wide ? "space-y-6" : "space-y-4")}>
          {groups.map((g) => (
            // La clave sale del primer enlace: el grupo del Panel no tiene título
            // y `undefined` no distingue a nadie.
            <div key={g.section ?? g.items[0].href}>
              {g.section &&
                (!wide ? (
                  // Plegada no hay lugar para el título, pero la separación entre
                  // dominios sí importa: sin ella el riel es una tira de once
                  // iconos sin ninguna estructura.
                  <div aria-hidden="true" className="mx-2 mb-2 border-t border-border" />
                ) : (
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.section}
                  </p>
                ))}
              <ul className="space-y-1">
                {g.items.map((item) => {
                  const { href, label, badge } = item;
                  const Icon = iconoDe(item);
                  const active = href === bestMatch;
                  // La marca entra en el nombre largo porque plegada NO hay
                  // dónde pintarla, y «borrador» es justo lo que hay que saber
                  // antes de entrar: es la diferencia entre un tablero que el
                  // equipo ve y uno que todavía no.
                  const completo = badge ? `${label} · ${badge}` : label;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={fila(active)}
                        // Desplegada el nombre se lee; el `title` solo hace
                        // falta en el riel, y ahí es la red de seguridad de
                        // quien no espera a que asome.
                        title={wide ? undefined : completo}
                        aria-label={wide ? undefined : completo}
                      >
                        <Icon className="size-4 shrink-0" />
                        {wide && <span className="min-w-0 truncate">{label}</span>}
                        {wide && badge && (
                          <span
                            className={cn(
                              "ml-auto shrink-0 rounded border px-1 py-0.5 text-[10px]",
                              active
                                ? "border-primary-foreground/40 text-primary-foreground"
                                : "border-warning/40 text-warning",
                            )}
                          >
                            {badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Configuración va al pie y separada del menú, no como una sección más:
            es donde se entra a montar la empresa y luego cada varios meses. Un
            renglón permanente entre el trabajo diario la hacía competir con la
            cola de tickets por la atención. */}
        {isAdminRole(role) && (
          <div className="border-t border-border p-4">
            <Link
              href="/admin/configuracion"
              className={fila(pathname.startsWith("/admin/configuracion"))}
              title={wide ? undefined : "Configuración"}
              aria-label={wide ? undefined : "Configuración"}
            >
              <Settings className="size-4 shrink-0" />
              {wide && "Configuración"}
            </Link>
          </div>
        )}

          {wide && (
            <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-xs text-muted-foreground">
              <span>
                Rol: <span className="font-medium text-foreground">{ROLE_LABELS[role]}</span>
              </span>
              <PoweredByAstraion />
            </div>
          )}
      </div>
    </aside>
  );
}
