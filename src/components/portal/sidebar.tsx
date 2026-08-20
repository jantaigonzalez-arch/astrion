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
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Marca de estado al final del renglón. Hoy solo la usan los tableros. */
  badge?: string;
};

/**
 * Un tablero publicable, tal como lo necesita el menú.
 *
 * Llega ya resuelto desde el servidor —qué módulo, cómo se llama, si está
 * publicado— porque decidirlo aquí exigiría leer la base desde el navegador
 * para pintar una barra lateral.
 */
export type TableroItem = {
  slug: string;
  /** El nombre que le puso quien lo compuso. */
  title: string;
  /**
   * Las pantallas de los módulos donde sale. Es lo que decide si este rol lo ve.
   *
   * En plural desde que un tablero puede publicarse en varios: basta con que UNA
   * de esas pantallas esté en el menú de este rol. Un tablero de cierre de mes
   * puesto en Ventas y en Rentabilidad tiene que verlo el vendedor —que tiene
   * Ventas— aunque Rentabilidad sea solo del administrador.
   */
  homes: string[];
  publicado: boolean;
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

/**
 * Añade la sección de tableros al final del menú de un rol.
 *
 * Va AL FINAL y no dentro de Análisis por lo mismo que ordena el resto: las
 * secciones siguen el circuito del trabajo —atiendo, vendo, tengo, compro— y un
 * tablero no es un paso de ese circuito, es la lectura de todos ellos. Y no
 * dentro de Análisis porque hay roles que no tienen esa sección y sí tienen
 * tableros que mirar.
 *
 * Qué tableros se ven se deduce del MENÚ QUE YA SE ARMÓ, no de una segunda
 * tabla de permisos por rol: si la pantalla del módulo no está en el menú de
 * este rol, su tablero tampoco. Escribir la regla dos veces es garantizar que
 * algún día digan cosas distintas, y el síntoma sería el peor de todos —un
 * tablero de cuentas por pagar en el menú de soporte.
 */
function conTableros(
  groups: NavGroup[],
  tableros: TableroItem[],
  role: MembershipRole,
): NavGroup[] {
  const visibles = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));

  const items = tableros
    // Basta con que salga en UN módulo que este rol ve. Un tablero sin módulos
    // no se filtra por rol —no hay pantalla contra la que comprobar— así que se
    // reserva para administración, que es quien lo compuso.
    .filter((t) =>
      t.homes.length > 0 ? t.homes.some((h) => visibles.has(h)) : isAdminRole(role),
    )
    // Sin publicar solo lo ve quien puede componerlo, igual que el botón del
    // módulo: nadie debería encontrarse un tablero a medio ordenar porque
    // alguien salió a comer.
    .filter((t) => t.publicado || isAdminRole(role))
    .map(
      (t): NavItem => ({
        href: `/admin/dashboard/${t.slug}`,
        label: t.title,
        Icon: ICONO_DE_MODULO[t.slug] ?? LayoutDashboard,
        badge: t.publicado ? undefined : "borrador",
      }),
    );

  // Administración siempre puede crear uno, y por eso su sección existe aunque
  // no haya ninguno todavía: sin este renglón, crear un tablero desde cero solo
  // se podría desde el botón de una pantalla que no tenga — un camino que hay
  // que descubrir por accidente.
  if (isAdminRole(role)) {
    items.push({
      href: "/admin/dashboard/nuevo",
      label: "Nuevo tablero",
      Icon: PlusCircle,
    });
  }

  // Sin tableros ni permiso para crearlos no hay sección: un encabezado
  // «Tableros» sobre una lista vacía ocupa sitio para decir que no hay nada.
  return items.length > 0 ? [...groups, { section: "Tableros", items }] : groups;
}

/**
 * Un grupo del menú. `section` es opcional a propósito: el Panel va suelto
 * arriba de todo, sin título, porque no es una categoría más — es la puerta de
 * entrada a todas las demás.
 */
type NavGroup = { section?: string; items: NavItem[] };

/**
 * Esta barra es la de UNA empresa y solo eso: la consola de Astraion vive en
 * `(console)`, y el camino entre los dos planos es la franja de contexto de
 * arriba (`TenantBar`).
 *
 * El menú se agrupa por DOMINIO DE NEGOCIO, no por nivel de permiso.
 *
 * Antes las secciones eran Operación / CRM / Administración, y "Administración"
 * era un cajón de sastre: Contratos (comercial), Rentabilidad (análisis),
 * Usuarios (personas) y Configuración (ajustes) uno debajo del otro. No había
 * una pregunta que alguien se hiciera que llevara a esa sección.
 *
 * Ahora cada sección responde a una pregunta real, y van EN EL ORDEN EN QUE SE
 * HACEN: qué atiendo hoy (Servicio), qué vendo (Ventas), qué tengo
 * (Inventario), qué compro (Compras), cómo vamos (Análisis). Y todo lo que es
 * ajuste salió del menú a su propia área, al pie.
 *
 * El Panel va suelto arriba de todas las secciones y no dentro de una de ellas.
 * Estaba metido como primer renglón de "Servicio" —y de "Ventas" para el
 * vendedor—, lo que lo hacía leer como una pantalla más de ese dominio cuando
 * en realidad es de dónde salen todos: el resumen del día, antes de elegir a
 * qué entrar.
 */
function navFor(role: MembershipRole, tableros: TableroItem[]): NavGroup[] {
  const panel: NavItem = {
    href: "/dashboard",
    label: role === "client" ? "Inicio" : "Panel",
    Icon: LayoutDashboard,
  };

  if (role === "client") {
    return [
      { items: [panel] },
      {
        section: "Portal",
        items: [
          { href: "/tickets", label: "Mis tickets", Icon: Ticket },
          { href: "/tickets/new", label: "Nuevo ticket", Icon: PlusCircle },
        ],
      },
    ];
  }

  // Ventas: el recorrido de una oportunidad, de contacto a contrato firmado.
  // Leads y Contratos entran aquí; estaban sueltos en "Administración" pese a
  // ser los dos extremos del mismo embudo.
  //
  // Pedidos va justo después del Embudo porque es lo que sigue: el negocio se
  // gana y deja de ser una oportunidad para pasar a ser trabajo. Antes no tenía
  // dónde vivir —al ganarlo caía en la lista de «cerrados», revuelto con los
  // perdidos— y desde que las requisiciones nacen de un pedido, no tener esa
  // pantalla dejaba el circuito empezando en un sitio al que no se podía entrar.
  const ventas: NavItem[] = [
    { href: "/admin/crm", label: "Embudo", Icon: KanbanSquare },
    // `Receipt` y no otro portapapeles: en este menú ya hay dos —levantamiento
    // y requisición— y un tercero los volvería indistinguibles de reojo, que es
    // como se lee una barra lateral.
    { href: "/admin/pedidos", label: "Pedidos", Icon: Receipt },
    // «Bandeja web» y ya no «Leads». Son los mensajes del formulario de
    // contacto: personas que escribieron, no empresas. Compartir nombre con las
    // organizaciones sin compra dejaba dos cosas distintas llamadas igual en el
    // mismo menú, y quien entraba buscando una encontraba la otra.
    { href: "/admin/leads", label: "Bandeja web", Icon: Mail },
    { href: "/admin/crm/leads", label: "Leads", Icon: Building2 },
    { href: "/admin/crm/contactos", label: "Contactos", Icon: Users2 },
    { href: "/admin/crm/actividades", label: "Actividades", Icon: CalendarCheck },
  ];

  /*
    Clientes: la post-venta, fuera de Ventas.

    Lo que se hace con un cliente —revisar su contrato, mirar su equipo
    instalado, atender sus tickets— no es vender. Tenerlo dentro de Ventas
    obligaba a cruzar 141 leads para llegar a los 24 que ya compran, y ponía la
    misma pantalla a servir dos trabajos que no se parecen.

    Contratos se muda aquí desde Ventas por la misma razón: un contrato es lo
    que pasa DESPUÉS de vender. Estaba en Ventas por herencia, no por criterio.
  */
  const clientes: NavItem[] = [
    { href: "/admin/clientes", label: "Clientes", Icon: Building2 },
    { href: "/admin/contratos", label: "Contratos", Icon: FileSignature },
  ];

  // Análisis: lo que se mira para decidir, no para trabajar. Separarlo evita
  // que un informe compita por atención con la cola de tickets.
  const analisis: NavItem[] = [
    { href: "/admin/crm/informes", label: "Informes", Icon: BarChart3 },
    { href: "/admin/crm/objetivos", label: "Objetivos", Icon: Target },
  ];

  if (role === "sales") {
    return conTableros(
      [
        { items: [panel] },
        { section: "Ventas", items: ventas },
        { section: "Clientes", items: clientes },
        { section: "Análisis", items: analisis },
      ],
      tableros,
      role,
    );
  }

  // Servicio es atender: la cola, lo que se levanta, lo que se resuelve.
  const servicio: NavItem[] = [
    { href: "/admin/tickets", label: "Cola de tickets", Icon: Inbox },
    { href: "/admin/tickets/new", label: "Nuevo levantamiento", Icon: ClipboardPlus },
  ];

  // Inventario es qué hay. Refacciones estaba en Servicio porque de ahí salen
  // las piezas que se consumen en un ticket, pero eso es de dónde se usa, no de
  // qué es: existencias, costos y sobregiros son un dominio propio, y este es
  // el apartado donde van a caer los movimientos y los conteos físicos.
  const inventario: NavItem[] = [
    { href: "/admin/refacciones", label: "Refacciones", Icon: Package },
  ];

  // Compras tiene sus puertas a la vista en vez de una sola que esconde a las
  // otras detrás de un botón: las órdenes son el trabajo del día y los
  // proveedores el padrón que lo sostiene, y se entra a cada uno por su cuenta.
  //
  // Las requisiciones van ANTES que las órdenes, por el mismo criterio que
  // ordena las secciones: se pide, se autoriza, se compra. Ponerlas después
  // haría parecer que son un apéndice de la orden cuando son el paso que la
  // origina.
  const compras: NavItem[] = [
    { href: "/admin/compras/requisiciones", label: "Requisiciones", Icon: ClipboardList },
    { href: "/admin/compras", label: "Órdenes de compra", Icon: ShoppingCart },
    { href: "/admin/compras/proveedores", label: "Proveedores", Icon: Truck },
  ];

  // Cuentas por pagar es de administración y no de soporte: quien recibe la
  // mercancía no debería ser también quien autoriza su pago.
  const porPagar: NavItem = {
    href: "/admin/compras/cuentas-por-pagar",
    label: "Cuentas por pagar",
    Icon: Wallet,
  };

  if (role === "agent") {
    return conTableros(
      [
        { items: [panel] },
        { section: "Servicio", items: servicio },
        { section: "Inventario", items: inventario },
        { section: "Compras", items: compras },
      ],
      tableros,
      role,
    );
  }

  // El orden de las secciones sigue el CIRCUITO, no el organigrama.
  //
  // Ventas iba debajo de Compras, y desde que existen las requisiciones eso se
  // leía al revés: la requisición nace de un pedido, así que tener Requisiciones
  // por encima de donde viven los pedidos contaba la historia hacia atrás. El
  // recorrido es: atiendo lo que ya hay abierto → vendo → miro qué tengo →
  // compro lo que falta.
  //
  // Inventario y Compras siguen pegados, que es lo que había que conservar al
  // mover Ventas: son la misma pregunta en dos tiempos —qué hay hoy y qué viene
  // en camino—, y meter Ventas entre ellos habría arreglado una lectura
  // rompiendo otra.
  return conTableros(
    [
      { items: [panel] },
      { section: "Servicio", items: servicio },
      { section: "Ventas", items: ventas },
      { section: "Clientes", items: clientes },
      { section: "Inventario", items: inventario },
      { section: "Compras", items: [...compras, porPagar] },
      // Rentabilidad solo la ve el administrador: mide el margen del negocio.
      {
        section: "Análisis",
        items: [
          { href: "/admin/rentabilidad", label: "Rentabilidad", Icon: TrendingUp },
          ...analisis,
          // La inteligencia va en Análisis y no en Configuración a propósito: no
          // es un ajuste que se deja puesto, es una herramienta que se consulta
          // para decidir, igual que Rentabilidad. Y no en una sección propia:
          // es donde se configura lo que las otras pantallas van a decir, no un
          // dominio de negocio aparte. Quien entra aquí viene de preguntarse
          // «cómo vamos», no «qué modelo entreno».
          { href: "/admin/inteligencia", label: "Inteligencia", Icon: Brain },
        ],
      },
    ],
    tableros,
    role,
  );
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
}: {
  role: MembershipRole;
  brand: TenantBrand;
  defaultCollapsed?: boolean;
  tableros?: TableroItem[];
}) {
  const pathname = usePathname();
  const groups = navFor(role, tableros);
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
                {g.items.map(({ href, label, Icon, badge }) => {
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
