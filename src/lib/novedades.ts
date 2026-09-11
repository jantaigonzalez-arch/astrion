import type { Modulo, Nivel } from "@/lib/permisos";

/**
 * LO NUEVO, CONTADO DENTRO DE LA APLICACIÓN.
 *
 * Un despliegue cambia pantallas que la gente usa a diario, y sin aviso lo nuevo
 * se descubre por accidente o no se descubre: la pestaña de Moneda existe, pero
 * nadie entra a Configuración a ver si hay algo distinto.
 *
 * El aviso es DISCRETO a propósito: un icono junto a la campana con un punto
 * mientras haya algo sin ver, y la lista al pulsarlo. Nada se abre solo ni tapa
 * la pantalla. Pasados `VIGENCIA_DIAS` sin novedades, el icono desaparece.
 *
 * ── CÓMO SE AGREGA UNA ─────────────────────────────────────────────────────
 *
 * Arriba de la lista, con la fecha del despliegue. Una línea que diga qué cambió
 * PARA QUIEN LO USA —no cómo se hizo— y, si tiene sitio, a dónde ir. `permisos`
 * decide quién la ve (basta uno); sin él, todo el equipo interno. Los clientes
 * del portal no ven ninguna mientras no haya una que les toque.
 */
export type Novedad = {
  /** Único y estable: es lo que se recuerda como «ya visto». */
  id: string;
  /** Día del despliegue, `AAAA-MM-DD`. */
  fecha: string;
  titulo: string;
  texto: string;
  href?: string;
  /** Quién la ve: con UNO de estos permisos basta. Sin él, todo el equipo. */
  permisos?: ReadonlyArray<readonly [Modulo, Nivel]>;
};

/** Cuántos días se enseña una novedad antes de retirarse sola. */
export const VIGENCIA_DIAS = 7;

export const NOVEDADES: readonly Novedad[] = [
  {
    id: "2026-09-11-tipo-de-cambio",
    fecha: "2026-09-11",
    titulo: "Tipo de cambio automático",
    texto:
      "Nueva pestaña Configuración → Moneda: el tipo de cambio se toma de Banxico cada día hábil y los negocios en dólares lo usan al guardarse. Puedes seguir usando uno manual.",
    href: "/admin/configuracion/moneda",
    permisos: [["configuracion", "administrar"]],
  },
  {
    id: "2026-09-11-usuarios",
    fecha: "2026-09-11",
    titulo: "Usuarios en dos pestañas",
    texto: "El equipo interno y los clientes del portal, por separado y con sus propias columnas.",
    href: "/admin/configuracion/usuarios",
    permisos: [["configuracion", "administrar"]],
  },
  {
    id: "2026-09-11-inventario",
    fecha: "2026-09-11",
    titulo: "Inventario más ágil",
    texto:
      "Busca, filtra y cambia de página sin cargar todo el catálogo. Nuevo filtro «Con existencia» para ver solo lo que hay en almacén.",
    href: "/admin/refacciones",
    permisos: [["inventario", "ver"]],
  },
  {
    id: "2026-09-11-buscar-refacciones",
    fecha: "2026-09-11",
    titulo: "Refacciones: se buscan al teclear",
    texto:
      "En la bitácora de los tickets, las órdenes de compra, las requisiciones y los negocios, escribe el número de parte o parte de la descripción.",
    permisos: [
      ["servicio", "ver"],
      ["compras", "ver"],
      ["ventas", "ver"],
    ],
  },
  {
    id: "2026-09-11-tablas",
    fecha: "2026-09-11",
    titulo: "Tablas más legibles",
    texto: "Los nombres largos se acomodan en renglones y ya no tapan la columna de al lado.",
  },
  {
    id: "2026-09-11-volver-ticket",
    fecha: "2026-09-11",
    titulo: "«Volver» desde un ticket",
    texto: "Ahora regresa a la cola de tickets, no a una lista vacía.",
    permisos: [["servicio", "ver"]],
  },
];
