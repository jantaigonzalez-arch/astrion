import type { MembershipRole } from "@/lib/db/platform";
import { alcanza, nivelEfectivo, puedeEntrar, type Ajustes } from "@/lib/permisos";

/**
 * QUÉ PANTALLAS VE CADA ROL. Solo el modelo: aquí no se pinta nada.
 *
 * ── POR QUÉ NO VIVE YA EN `sidebar.tsx` ────────────────────────────────────
 *
 * Porque este menú no solo dibuja: DECIDE. La regla de qué tableros ve un rol
 * se deduce del menú ya armado —si la pantalla del módulo no está, su tablero
 * tampoco—, y mientras esa deducción vivía dentro de un componente `use client`
 * era imposible de aplicar en el servidor. El resultado fue exactamente lo que
 * la regla existía para evitar, solo que por la puerta de atrás: la barra
 * lateral escondía el tablero de Ventas al agente de soporte, y
 * `/admin/dashboard/ventas` se lo enseñaba entero si lo escribía en la barra de
 * direcciones — y ésa es una dirección que la aplicación INVITA a compartir
 * (ver `createDashboard`: el slug no cambia justamente para que el enlace se
 * pueda mandar).
 *
 * Un archivo de modelo, sin `use client` y sin hooks, lo resuelve sin duplicar
 * nada: lo importa la barra para pintarse y lo importa la pantalla del tablero
 * para dejar entrar o no.
 *
 * ── Y SIN ICONOS ───────────────────────────────────────────────────────────
 *
 * Un `NavItem` de aquí es dirección, nombre y marca; el icono lo pone quien
 * dibuja. Tenerlos aquí obligaba a importar `lucide-react`, y eso convertía una
 * regla de permiso en algo que solo se puede ejercitar dentro de un navegador:
 * `lucide-react` llama a `createContext` al cargarse, que bajo la condición
 * `react-server` —la que usan los probes y el propio servidor— no existe. Una
 * decisión de quién ve qué tiene que poder comprobarse desde un script contra
 * la base real, sin abrir nada.
 */

export type NavItem = {
  href: string;
  label: string;
  /** Marca de estado al final del renglón. Hoy solo la usan los tableros. */
  badge?: string;
};

/**
 * Un grupo del menú. `section` es opcional a propósito: el Panel va suelto
 * arriba de todo, sin título, porque no es una categoría más — es la puerta de
 * entrada a todas las demás.
 */
export type NavGroup = { section?: string; items: NavItem[] };

/**
 * Un tablero publicable, tal como lo necesita el menú.
 *
 * Llega ya resuelto desde el servidor —dónde sale, cómo se llama, si está
 * publicado— porque decidirlo en la barra exigiría leer la base desde el
 * navegador para pintar una lista.
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
  /**
   * Bloques encendidos que NO son de administración.
   *
   * Es lo único que hay que saber para no ofrecerle a alguien un tablero que se
   * le va a abrir vacío: los análisis `adminOnly` se filtran al pintarlo, así
   * que un tablero hecho solo de ellos tiene bloques para el administrador y
   * ninguno para el resto. Ver `DashboardState.bloquesPublicos`.
   */
  bloquesPublicos: number;
};

/**
 * Si este rol puede ver este tablero. LA regla, y la única.
 *
 * Son tres condiciones y ninguna sobra:
 *
 *   dónde sale    si la pantalla del módulo no está en el menú de este rol, su
 *                 tablero tampoco. Un tablero sin ningún módulo no tiene contra
 *                 qué comprobarse, así que se reserva a administración, que es
 *                 quien lo compuso.
 *   publicado     sin publicar solo lo ve quien puede componerlo: nadie debería
 *                 encontrarse un tablero a medio ordenar porque alguien salió a
 *                 comer.
 *   con qué       un tablero cuyos análisis son todos de administración no tiene
 *                 nada que enseñarle a nadie más, y ofrecerlo es mandar a
 *                 alguien a una pantalla vacía.
 *
 * La tercera es la que faltaba y se vio en bajío: el tablero «test», publicado
 * en Servicio y compuesto solo de cuentas por pagar, salía en el menú de
 * soporte y se abría en blanco. Contar bloques sin mirar de quién son cuenta
 * los del administrador para todo el mundo.
 */
/** Componer tableros es administrar Análisis. Una sola definición, dos usos. */
function puedeComponerTableros(role: MembershipRole, ajustes?: Ajustes): boolean {
  return alcanza(nivelEfectivo(role, ajustes, "analisis"), "administrar");
}

export function tableroVisiblePara(
  role: MembershipRole,
  t: TableroItem,
  ajustes?: Ajustes,
): boolean {
  // Quien ADMINISTRA Análisis ve hasta lo que está sin publicar: es quien
  // compone. Por permiso y no por `isAdminRole`, para que dárselo a alguien sin
  // subirle el rol funcione de verdad — que es el punto entero del modelo.
  if (puedeComponerTableros(role, ajustes)) return true;
  if (!t.publicado) return false;
  if (t.bloquesPublicos === 0) return false;
  if (t.homes.length === 0) return false;

  const mias = pantallasDelRol(role, ajustes);
  return t.homes.some((h) => mias.has(h));
}

/**
 * Las direcciones que este rol tiene en su menú, tableros aparte.
 *
 * Exportada porque decide dos cosas y no una: qué tableros se ven —ver
 * `tableroVisiblePara`— y qué áreas resume la pantalla de llegada. Un vendedor
 * no tiene Compras en el menú, así que tampoco debe leer ahí cuántas facturas
 * hay por pagar: es información que no puede ir a ver y que además es de
 * administración. Preguntárselo al mismo sitio es lo que impide que un día
 * digan cosas distintas.
 */
export function pantallasDelRol(
  role: MembershipRole,
  ajustes?: Ajustes,
): Set<string> {
  return new Set(menuDelRol(role, false, ajustes).flatMap((g) => g.items.map((i) => i.href)));
}

/**
 * LA CAPA DE INTELIGENCIA: UN SOLO GRUPO AL FINAL DEL MENÚ.
 *
 * Inteligencia y los tableros van juntos y aparte de todo lo demás, y no es una
 * cuestión de orden sino de qué clase de cosa son. Las secciones de arriba
 * siguen el circuito del trabajo —atiendo, vendo, tengo, compro— y cada una
 * enseña lo que alguien capturó. Estas dos no: una ESTIMA lo que todavía no ha
 * pasado y la otra CRUZA los seis módulos para sacar una lectura. Son una capa
 * encima, no un paso más del circuito, y mezclarlas con el resto hace que un
 * pronóstico se lea como un reporte.
 *
 * Va al final por la misma razón, y con su propio aspecto una vez dentro: ver
 * `.capa-inteligencia` en `globals.css`.
 *
 * ── POR QUÉ SIGUE SIENDO UNA FUNCIÓN Y NO UNA ENTRADA MÁS DE LA LISTA ─────
 *
 * Porque los tableros son datos, no rutas fijas: cuántos hay y cuáles se ven
 * depende de quién mire (`tableroVisiblePara`). Inteligencia sí es fija, así que
 * entra aquí como primer renglón del grupo — es la puerta de la capa, y los
 * tableros, lo que se compone dentro de ella.
 */
function conTableros(
  groups: NavGroup[],
  tableros: TableroItem[],
  role: MembershipRole,
  ajustes?: Ajustes,
): NavGroup[] {
  const items: NavItem[] = [];

  // Inteligencia encabeza la capa. Se filtra igual que todo lo demás: quien no
  // administra Análisis no la ve, y entonces el grupo puede quedar solo con
  // tableros — que es lo correcto, porque hay quien tiene tableros que mirar sin
  // poder configurar un modelo.
  if (puedeEntrar(role, ajustes, "/admin/inteligencia")) {
    items.push({ href: "/admin/inteligencia", label: "Inteligencia" });
  }

  const deTableros = tableros
    .filter((t) => tableroVisiblePara(role, t, ajustes))
    .map(
      (t): NavItem => ({
        href: `/admin/dashboard/${t.slug}`,
        label: t.title,
        badge: t.publicado ? undefined : "borrador",
      }),
    );

  items.push(...deTableros);

  // Administración siempre puede crear uno, y por eso el renglón existe aunque
  // no haya ningún tablero todavía: sin él, crear uno desde cero solo se podría
  // desde el botón de una pantalla que no tenga — un camino que hay que
  // descubrir por accidente.
  if (puedeComponerTableros(role, ajustes)) {
    items.push({ href: "/admin/dashboard/nuevo", label: "Nuevo tablero" });
  }

  // Sin nada dentro no hay grupo: un encabezado sobre una lista vacía ocupa
  // sitio para decir que no hay nada.
  return items.length > 0 ? [...groups, { section: "Inteligencia", items }] : groups;
}

/**
 * El menú de un rol SIN la sección de tableros.
 *
 * Separado de `navFor` porque es de donde sale la regla de permiso: qué
 * tableros se ven se deduce del menú ya armado, y armarlo con los tableros
 * dentro sería preguntarle a la respuesta. Ver `tableroVisiblePara`.
 *
 * ── CÓMO SE AGRUPA ─────────────────────────────────────────────────────────
 *
 * Por DOMINIO DE NEGOCIO, no por nivel de permiso.
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
function menuDelRol(
  role: MembershipRole,
  deVisita = false,
  ajustes?: Ajustes,
): NavGroup[] {
  const panel: NavItem = {
    href: "/dashboard",
    /**
     * «Panel» nombra un tablero de mando: LO TUYO, resumido. Para personal de
     * Astraion esa pantalla ya no es eso —es la bienvenida a la empresa que
     * está visitando, con su nombre y el aviso de solo lectura—, y el menú se
     * quedaba llamándola por el nombre de lo que dejó de ser. Es el único
     * renglón de esta barra que no es un sitio de la empresa, así que era
     * también el único que podía quedar hablando de otra cosa.
     *
     * Mismo criterio por el que un cliente lee «Inicio»: el renglón dice a qué
     * se entra, no cómo se llamaba antes.
     */
    label: role === "client" || deVisita ? "Inicio" : "Panel",
  };

  if (role === "client") {
    return [
      { items: [panel] },
      {
        section: "Portal",
        items: [
          { href: "/tickets", label: "Mis tickets" },
          { href: "/tickets/new", label: "Nuevo ticket" },
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
    { href: "/admin/crm", label: "Embudo" },
    // `Receipt` y no otro portapapeles: en este menú ya hay dos —levantamiento
    // y requisición— y un tercero los volvería indistinguibles de reojo, que es
    // como se lee una barra lateral.
    { href: "/admin/pedidos", label: "Pedidos" },
    // «Bandeja web» y ya no «Leads». Son los mensajes del formulario de
    // contacto: personas que escribieron, no empresas. Compartir nombre con las
    // organizaciones sin compra dejaba dos cosas distintas llamadas igual en el
    // mismo menú, y quien entraba buscando una encontraba la otra.
    { href: "/admin/leads", label: "Solicitudes del sitio" },
    { href: "/admin/crm/prospectos", label: "Prospectos" },
    { href: "/admin/crm/contactos", label: "Contactos" },
    { href: "/admin/crm/actividades", label: "Actividades" },
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
    { href: "/admin/clientes", label: "Clientes" },
    { href: "/admin/contratos", label: "Contratos" },
  ];

  // Análisis: lo que se mira para decidir, no para trabajar. Separarlo evita
  // que un informe compita por atención con la cola de tickets.
  const analisis: NavItem[] = [
    { href: "/admin/crm/informes", label: "Informes" },
    { href: "/admin/crm/objetivos", label: "Objetivos" },
  ];

  // Servicio es atender: la cola, lo que se levanta, lo que se resuelve.
  const servicio: NavItem[] = [
    { href: "/admin/tickets", label: "Cola de tickets" },
    { href: "/admin/tickets/new", label: "Nuevo levantamiento" },
  ];

  // Inventario es qué hay. Refacciones estaba en Servicio porque de ahí salen
  // las piezas que se consumen en un ticket, pero eso es de dónde se usa, no de
  // qué es: existencias, costos y sobregiros son un dominio propio, y este es
  // el apartado donde van a caer los movimientos y los conteos físicos.
  const inventario: NavItem[] = [
    { href: "/admin/refacciones", label: "Refacciones" },
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
    { href: "/admin/compras/requisiciones", label: "Requisiciones" },
    { href: "/admin/compras", label: "Órdenes de compra" },
    { href: "/admin/compras/proveedores", label: "Proveedores" },
  ];

  // Cuentas por pagar es de administración y no de soporte: quien recibe la
  // mercancía no debería ser también quien autoriza su pago.
  const porPagar: NavItem = {
    href: "/admin/compras/cuentas-por-pagar",
    label: "Cuentas por pagar",
   
  };

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
  /*
    UN SOLO MENÚ, FILTRADO POR LO QUE CADA QUIEN PUEDE.

    Antes había una lista por rol: una para el vendedor, otra para el agente y
    ésta para administración. Tres copias de la misma estructura que había que
    mantener de acuerdo entre sí, y que ADEMÁS no podían expresar el caso que
    este modelo vino a resolver — el agente al que se le da Cuentas por pagar no
    es ninguno de los tres moldes.

    Ahora se arma el menú completo y se quita lo que la persona no alcanza. El
    orden es el mismo de antes, así que cada rol sigue viendo lo suyo en el
    mismo sitio: al vendedor, filtrar deja Ventas, Clientes y Análisis, que es
    exactamente la lista que tenía escrita a mano. Hay un probe que lo comprueba
    rol por rol contra el comportamiento anterior.

    Filtrar por `puedeEntrar` —y no por el rol— es lo que hace que la barra y el
    guardia de cada pantalla no puedan discrepar: leen la misma regla. Es la
    lección de la cabecera de este archivo, ahora con una sola fuente de verdad
    en vez de dos que se parecen.
  */
  const completo: NavGroup[] = [
    { items: [panel] },
    { section: "Servicio", items: servicio },
    { section: "Ventas", items: ventas },
    { section: "Clientes", items: clientes },
    { section: "Inventario", items: inventario },
    { section: "Compras", items: [...compras, porPagar] },
    {
      section: "Análisis",
      items: [{ href: "/admin/rentabilidad", label: "Rentabilidad" }, ...analisis],
    },
  ];

  return completo
    .map((g) => ({ ...g, items: g.items.filter((i) => puedeEntrar(role, ajustes, i.href)) }))
    // Una sección sin renglones es un encabezado sobre el vacío. El grupo del
    // panel no tiene `section` y nunca queda vacío, así que no hay que
    // protegerlo aparte.
    .filter((g) => g.items.length > 0);
}

/** El menú completo de un rol, con su sección de tableros al final. */
export function navFor(
  role: MembershipRole,
  tableros: TableroItem[],
  ajustes: Ajustes | undefined,
  /** Personal de Astraion dentro de la empresa de un cliente. Solo cambia cómo
   *  se llama el primer renglón; no cambia qué pantallas se ven, que eso lo
   *  decide el rol y nada más. */
  deVisita = false,
): NavGroup[] {
  return conTableros(menuDelRol(role, deVisita, ajustes), tableros, role, ajustes);
}
