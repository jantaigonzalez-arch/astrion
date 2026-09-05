import type { MembershipRole } from "@/lib/db/platform";

/**
 * QUÉ PUEDE HACER CADA PERSONA, MÓDULO POR MÓDULO.
 *
 * ── EL ROL ES LA PLANTILLA, NO LA ÚLTIMA PALABRA ──────────────────────────
 *
 * Hasta aquí el permiso era el rol y nada más: agente, vendedor, administrador.
 * Funciona mientras todo el mundo encaje en uno de los cinco moldes, y deja de
 * funcionar en cuanto alguien no encaja — el agente que además captura facturas,
 * el vendedor que no debe ver los informes, la persona de compras que puede
 * levantar órdenes pero no autorizar pagos. La única salida era subirle el rol,
 * y subir un rol da MUCHO más de lo que se quería dar.
 *
 * Ahora el rol decide el punto de partida y por persona se ajusta módulo a
 * módulo. Lo que no se toca sigue al rol, así que una cuenta sin ajustes se
 * comporta exactamente como antes: es la propiedad que hace que esto se pueda
 * desplegar sin reconfigurar a nadie.
 *
 * ── CUATRO NIVELES, Y EL CUARTO NO SOBRA ──────────────────────────────────
 *
 * `ninguno` · `ver` · `editar` · `administrar`, y son acumulativos: quien puede
 * editar puede ver.
 *
 * `administrar` existe porque el sistema YA separa hoy lo que deja huella hacia
 * atrás de lo que es el trabajo del día, y borrar esa distinción al pasar a este
 * modelo habría sido regalar permisos en silencio. Un agente puede recibir
 * mercancía y no puede cancelar la orden; puede levantar una requisición y no
 * autorizarla. Eso es exactamente `editar` contra `administrar`.
 *
 * ── LAS RUTAS DECLARAN LO QUE PIDEN ───────────────────────────────────────
 *
 * Un módulo no es un bloque de todo o nada: dentro de Análisis, los informes
 * comerciales son de quien vende y la rentabilidad es de quien administra. Por
 * eso cada ruta dice qué nivel exige (`RUTAS`), en vez de que el módulo entero
 * tenga una sola puerta.
 *
 * ── UNA SOLA FUENTE PARA VER Y PARA DEJAR ENTRAR ──────────────────────────
 *
 * Este archivo lo usan el menú lateral —para pintarse— y las pantallas y las
 * acciones —para dejar pasar o no—. Es a propósito y es la lección que ya está
 * escrita en la cabecera de `portal/menu.ts`: cuando la regla de «quién ve qué»
 * vivía solo en el componente que dibuja, la barra escondía el tablero de Ventas
 * al agente y la dirección escrita a mano se lo enseñaba entero.
 *
 * Sin `use client`, sin hooks y sin iconos, por el mismo motivo que aquel: una
 * decisión de permiso tiene que poder comprobarse desde un script contra la base
 * real, sin abrir un navegador.
 */

/* ============================== Los niveles ============================== */

export const NIVELES = ["ninguno", "ver", "editar", "administrar"] as const;
export type Nivel = (typeof NIVELES)[number];

/** Orden de menor a mayor. Comparar por índice es lo que los hace acumulativos. */
const RANGO: Record<Nivel, number> = {
  ninguno: 0,
  ver: 1,
  editar: 2,
  administrar: 3,
};

export const NIVEL_LABELS: Record<Nivel, string> = {
  ninguno: "Sin acceso",
  ver: "Ver",
  editar: "Ver y editar",
  administrar: "Administrar",
};

/** Qué significa cada nivel, para que quien configura no tenga que adivinarlo. */
export const NIVEL_AYUDA: Record<Nivel, string> = {
  ninguno: "No aparece en el menú y la dirección no abre.",
  ver: "Entra y consulta. No puede cambiar nada.",
  editar: "El trabajo del día: crear y modificar.",
  administrar: "Además, lo que deja huella: autorizar, cancelar, borrar.",
};

export function alcanza(tiene: Nivel, exige: Nivel): boolean {
  return RANGO[tiene] >= RANGO[exige];
}

/* ============================== Los módulos ============================== */

export const MODULOS = [
  "servicio",
  "ventas",
  "clientes",
  "inventario",
  "compras",
  "pagar",
  "viaticos",
  "analisis",
  "configuracion",
] as const;
export type Modulo = (typeof MODULOS)[number];

/**
 * Nombre y descripción de cada módulo.
 *
 * Los nombres son los de las secciones de la barra lateral, y eso no es
 * casualidad: quien configura a una persona tiene que poder reconocer en esta
 * pantalla lo mismo que esa persona va a ver en su menú. Inventar aquí una
 * taxonomía propia obligaría a traducir mentalmente entre dos listas.
 */
export const MODULO_INFO: Record<Modulo, { label: string; detalle: string }> = {
  servicio: {
    label: "Servicio",
    detalle: "Cola de tickets, levantamientos y equipos instalados.",
  },
  ventas: {
    label: "Ventas",
    detalle: "Embudo, pedidos, leads, contactos y actividades.",
  },
  clientes: {
    label: "Clientes",
    detalle: "Padrón de clientes y sus contratos.",
  },
  inventario: {
    label: "Inventario",
    detalle: "Refacciones, existencias y costos.",
  },
  compras: {
    label: "Compras",
    detalle: "Requisiciones, órdenes de compra y proveedores.",
  },
  pagar: {
    label: "Cuentas por pagar",
    detalle: "Facturas de proveedor, pagos, notas de crédito y anticipos.",
  },
  viaticos: {
    label: "Viáticos",
    detalle: "Solicitudes de viaje del ingeniero y su comprobación de gastos.",
  },
  analisis: {
    label: "Análisis",
    detalle: "Informes, objetivos, tableros, rentabilidad e inteligencia.",
  },
  configuracion: {
    label: "Configuración",
    detalle: "Usuarios, catálogos, plantillas y ajustes de la empresa.",
  },
};

/* ========================= Lo que da cada rol ========================= */

/**
 * El punto de partida de cada rol, módulo por módulo.
 *
 * ── ESTA TABLA NO INVENTA NADA ────────────────────────────────────────────
 *
 * Reproduce lo que cada rol podía hacer ANTES de que existiera este archivo,
 * leído de los guardias que ya estaban repartidos por el código:
 *
 *   · el agente atiende y compra, pero no autoriza pagos ni cancela órdenes
 *     (`isSupport` para crear y recibir, `isAdminRole` para cancelar);
 *   · el vendedor lleva el embudo y los contratos, y de Análisis solo tiene
 *     informes y objetivos —rentabilidad e inteligencia eran de administración—;
 *   · el cliente no entra a ningún módulo interno;
 *   · administrador y dueño tienen todo.
 *
 * Que sea fiel es lo que permite desplegar esto sin tocar una sola cuenta: con
 * la tabla vacía de ajustes, todo el mundo conserva exactamente el acceso que
 * tenía. Hay un probe que lo comprueba comparando el menú viejo contra el nuevo
 * para los cinco roles.
 *
 * El dueño se separa del administrador en `isOwner` y no aquí: lo suyo
 * —facturación, ceder datos al entrenamiento— no es un módulo del menú, es una
 * facultad sobre la cuenta. Ver `roles.ts`.
 */
const BASE: Record<MembershipRole, Record<Modulo, Nivel>> = {
  client: {
    servicio: "ninguno",
    ventas: "ninguno",
    clientes: "ninguno",
    inventario: "ninguno",
    compras: "ninguno",
    pagar: "ninguno",
    viaticos: "ninguno",
    analisis: "ninguno",
    configuracion: "ninguno",
  },
  agent: {
    servicio: "editar",
    ventas: "ninguno",
    clientes: "ninguno",
    inventario: "editar",
    compras: "editar",
    pagar: "ninguno",
    /*
      `editar` y no `administrar`: el ingeniero PIDE su viático y comprueba sus
      gastos, y no puede autorizar ni el suyo ni el de nadie. Es la misma línea
      que ya separa levantar una requisición de autorizarla, y es toda la razón
      de que este documento exista: con la misma persona en las dos casillas, el
      viático sería un trámite y no un control.
    */
    viaticos: "editar",
    analisis: "ninguno",
    configuracion: "ninguno",
  },
  sales: {
    servicio: "ninguno",
    ventas: "editar",
    clientes: "editar",
    inventario: "ninguno",
    compras: "ninguno",
    pagar: "ninguno",
    /* Quien vende no viaja a dar servicio ni autoriza el gasto de quien viaja. */
    viaticos: "ninguno",
    analisis: "ver",
    configuracion: "ninguno",
  },
  /*
    GENERAL: administra el GASTO, y nada más.

    Compras, cuentas por pagar y viáticos en `administrar` —autoriza, cancela,
    da el visto bueno—; el resto en `ninguno`. Ni Ventas, ni Clientes, ni
    Configuración, ni Análisis: quien revisa comprobantes de hotel no tiene por
    qué ver el margen de cada contrato ni dar de alta usuarios.

    Servicio queda en `ver` y es deliberado: un viático llega con un ticket de
    servicio en cada gasto, y sin poder abrirlo la revisión se hace a ciegas.
    `ver` y no más — General no atiende tickets.
  */
  general: {
    servicio: "ver",
    ventas: "ninguno",
    clientes: "ninguno",
    inventario: "ninguno",
    compras: "administrar",
    pagar: "administrar",
    viaticos: "administrar",
    analisis: "ninguno",
    configuracion: "ninguno",
  },
  admin: {
    servicio: "administrar",
    ventas: "administrar",
    clientes: "administrar",
    inventario: "administrar",
    compras: "administrar",
    pagar: "administrar",
    viaticos: "administrar",
    analisis: "administrar",
    configuracion: "administrar",
  },
  owner: {
    servicio: "administrar",
    ventas: "administrar",
    clientes: "administrar",
    inventario: "administrar",
    compras: "administrar",
    pagar: "administrar",
    viaticos: "administrar",
    analisis: "administrar",
    configuracion: "administrar",
  },
};

/** Lo que da el rol, sin ajustes. */
export function nivelDelRol(role: MembershipRole, modulo: Modulo): Nivel {
  return BASE[role][modulo];
}

/* ========================= Los ajustes por persona ========================= */

/**
 * Lo que se guarda en `memberships.permissions`.
 *
 * Un mapa PARCIAL, y ahí está la idea entera: la ausencia de una clave significa
 * «lo que diga el rol», no «sin acceso». Guardar los ocho módulos siempre haría
 * que cambiar la plantilla de un rol no llegara nunca a quien ya está dado de
 * alta — cada cuenta se habría quedado con una copia congelada del día que se
 * creó.
 */
export type Ajustes = Partial<Record<Modulo, Nivel>>;

/**
 * Lo que la persona puede de verdad en un módulo.
 *
 * El ajuste REEMPLAZA al rol para ese módulo, en los dos sentidos: sirve para
 * quitarle Compras a un agente y para darle Cuentas por pagar sin convertirlo en
 * administrador. Que valga en ambas direcciones es justamente lo que evita el
 * ascenso de rol como única herramienta.
 */
export function nivelEfectivo(
  role: MembershipRole,
  ajustes: Ajustes | null | undefined,
  modulo: Modulo,
): Nivel {
  const puesto = ajustes?.[modulo];
  return puesto ?? nivelDelRol(role, modulo);
}

/**
 * Sanea lo que viene de la base o de un formulario.
 *
 * `permissions` es `jsonb`: puede traer un módulo que esta versión ya no
 * conoce, un nivel escrito a mano o directamente basura. Se descarta lo que no
 * se reconozca en vez de confiar en el tipo — el tipo describe la intención, no
 * lo que puede llegar. Es la misma lección que dejó una fila de `viz` con un
 * nombre viejo tumbando un tablero entero.
 */
export function ajustesGuardados(v: unknown): Ajustes {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Ajustes = {};
  for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
    if (!(MODULOS as readonly string[]).includes(k)) continue;
    if (typeof valor !== "string") continue;
    if (!(NIVELES as readonly string[]).includes(valor)) continue;
    out[k as Modulo] = valor as Nivel;
  }
  return out;
}

/* ============================ Rutas y su nivel ============================ */

/**
 * Qué módulo y qué nivel exige cada zona de la aplicación.
 *
 * ── SE BUSCA POR EL PREFIJO MÁS LARGO ─────────────────────────────────────
 *
 * `/admin/compras/cuentas-por-pagar` tiene que caer en Cuentas por pagar y no
 * en Compras, aunque una dirección sea prefijo de la otra. Ordenar por longitud
 * al resolver hace que la regla más específica gane sin tener que declarar
 * excepciones a mano — y sin que el orden de esta lista importe, que es lo que
 * la hace segura de editar.
 *
 * ── POR QUÉ ALGUNAS PIDEN `administrar` ───────────────────────────────────
 *
 * Porque dentro de un módulo no todo pesa igual. Rentabilidad e Inteligencia
 * viven en Análisis y eran de administración antes de esto; dejarlas en `ver`
 * habría abierto el margen del negocio a cualquiera con informes. Igual con
 * dar de alta o capturar: la pantalla que CREA algo exige `editar`, mientras
 * que la que solo lista se conforma con `ver`.
 */
/**
 * ── UNA REGLA PUEDE NOMBRAR MÁS DE UN MÓDULO ──────────────────────────────
 *
 * Casi ninguna lo necesita, pero la ficha de la organización sí: la misma
 * empresa es un prospecto para Ventas y un cliente para Servicio, y es UN solo
 * registro. Atarla a `ventas` dejaría fuera a quien lleva la cartera de
 * clientes; atarla a `clientes`, al vendedor que la está prospectando.
 *
 * Cuando hay varios, basta con alcanzar el nivel en UNO. Es una disyunción a
 * propósito: son dos maneras de tener asunto con la misma empresa, no dos
 * requisitos que haya que cumplir a la vez.
 */
type Regla = { prefijo: string; modulo: Modulo | Modulo[]; nivel: Nivel };

const RUTAS: Regla[] = [
  // ── Servicio ──
  { prefijo: "/admin/tickets", modulo: "servicio", nivel: "ver" },
  { prefijo: "/admin/tickets/new", modulo: "servicio", nivel: "editar" },
  { prefijo: "/admin/equipos", modulo: "servicio", nivel: "ver" },

  // ── Ventas ──
  { prefijo: "/admin/crm", modulo: "ventas", nivel: "ver" },
  { prefijo: "/admin/crm/nuevo", modulo: "ventas", nivel: "editar" },
  { prefijo: "/admin/pedidos", modulo: "ventas", nivel: "ver" },
  { prefijo: "/admin/leads", modulo: "ventas", nivel: "ver" },

  // ── Clientes ──
  { prefijo: "/admin/clientes", modulo: "clientes", nivel: "ver" },
  // La ficha de la empresa no es de Ventas ni de Servicio: las dos la leen.
  { prefijo: "/admin/organizaciones", modulo: ["ventas", "clientes"], nivel: "ver" },
  { prefijo: "/admin/organizaciones/nueva", modulo: ["ventas", "clientes"], nivel: "editar" },
  { prefijo: "/admin/contratos", modulo: "clientes", nivel: "ver" },
  { prefijo: "/admin/contratos/nuevo", modulo: "clientes", nivel: "editar" },

  // ── Inventario ──
  { prefijo: "/admin/refacciones", modulo: "inventario", nivel: "ver" },

  // ── Compras ──
  { prefijo: "/admin/compras", modulo: "compras", nivel: "ver" },
  { prefijo: "/admin/compras/nueva", modulo: "compras", nivel: "editar" },
  { prefijo: "/admin/compras/requisiciones", modulo: "compras", nivel: "ver" },
  { prefijo: "/admin/compras/proveedores", modulo: "compras", nivel: "ver" },

  // ── Cuentas por pagar ── (más específico que /admin/compras: gana por largo)
  { prefijo: "/admin/compras/cuentas-por-pagar", modulo: "pagar", nivel: "ver" },
  { prefijo: "/admin/compras/cuentas-por-pagar/nueva", modulo: "pagar", nivel: "administrar" },
  { prefijo: "/admin/compras/cuentas-por-pagar/importar", modulo: "pagar", nivel: "administrar" },
  { prefijo: "/admin/compras/cuentas-por-pagar/analisis", modulo: "pagar", nivel: "ver" },

  // ── Viáticos ──
  //
  // La lista y la ficha se abren con `ver` y la pantalla decide QUÉ enseña: el
  // ingeniero, lo suyo; General, todo. Acotar por dirección no serviría —es la
  // misma— y por eso el filtro por persona vive en `data/viaticos.ts`, que es
  // el único sitio donde se puede aplicar sin que se olvide en una pantalla.
  { prefijo: "/admin/viaticos", modulo: "viaticos", nivel: "ver" },
  { prefijo: "/admin/viaticos/nuevo", modulo: "viaticos", nivel: "editar" },

  // ── Análisis ──
  { prefijo: "/admin/crm/informes", modulo: "analisis", nivel: "ver" },
  { prefijo: "/admin/crm/objetivos", modulo: "analisis", nivel: "ver" },
  { prefijo: "/admin/dashboard", modulo: "analisis", nivel: "ver" },
  { prefijo: "/admin/dashboard/nuevo", modulo: "analisis", nivel: "administrar" },
  { prefijo: "/admin/rentabilidad", modulo: "analisis", nivel: "administrar" },
  { prefijo: "/admin/inteligencia", modulo: "analisis", nivel: "administrar" },

  // ── Configuración ──
  { prefijo: "/admin/configuracion", modulo: "configuracion", nivel: "administrar" },
];

/** Las reglas, de la más específica a la más general. Ver la nota de `RUTAS`. */
const RUTAS_ORDENADAS = [...RUTAS].sort((a, b) => b.prefijo.length - a.prefijo.length);

/**
 * Qué exige una dirección, o `null` si no está bajo ningún módulo.
 *
 * `null` significa «esto no lo gobierna el permiso por módulo» —el panel, el
 * portal del cliente, la búsqueda— y quien pregunta debe dejarlo pasar. No es
 * lo mismo que «sin acceso», y confundirlos cerraría media aplicación.
 */
export function exigenciaDe(
  pathname: string,
): { modulos: Modulo[]; nivel: Nivel } | null {
  // Sin el prefijo de idioma ni el de empresa: lo que se compara es la ruta
  // dentro del portal, que es como están escritas las reglas. Ver `nav.tsx`.
  const limpio = pathname.replace(/^\/(es|en)(?=\/|$)/, "");
  const regla = RUTAS_ORDENADAS.find(
    (r) => limpio === r.prefijo || limpio.startsWith(`${r.prefijo}/`),
  );
  if (!regla) return null;
  const modulos = Array.isArray(regla.modulo) ? regla.modulo : [regla.modulo];
  return { modulos, nivel: regla.nivel };
}

/** ¿Esta persona puede abrir esta dirección? */
export function puedeEntrar(
  role: MembershipRole,
  ajustes: Ajustes | null | undefined,
  pathname: string,
): boolean {
  const exige = exigenciaDe(pathname);
  if (!exige) return true;
  return exige.modulos.some((m) => alcanza(nivelEfectivo(role, ajustes, m), exige.nivel));
}
