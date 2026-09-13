/**
 * LO QUE DECIDE CADA EMPRESA SOBRE SUS CLIENTES, en su forma pura (0038).
 *
 * Sin `server-only` a propósito: lo leen la tarjeta de Configuración → Clientes
 * —en el navegador—, `data/settings.ts` al sanear la fila y el dominio al
 * decidir. Una sola definición de qué valores existen, para que la pantalla no
 * ofrezca uno que el servidor no entiende.
 */

/** Qué hace cliente a una organización. Lo lee `ES_CLIENTE` en `data/crm.ts`. */
export const PRUEBAS_DE_CLIENTE = ["portal", "pedido", "contrato"] as const;
export type PruebaDeCliente = (typeof PRUEBAS_DE_CLIENTE)[number];

export const PRUEBA_LABELS: Record<PruebaDeCliente, { titulo: string; ayuda: string }> = {
  portal: {
    titulo: "Cuenta de portal",
    ayuda: "Tiene una cuenta enlazada: así llegaron los clientes del sistema anterior, con sus equipos y tickets.",
  },
  pedido: {
    titulo: "Negocio ganado",
    ayuda: "Ganó un negocio en el embudo: es el camino de todo lo que se venda desde hoy.",
  },
  contrato: {
    titulo: "Contrato",
    ayuda: "Firmó un contrato que salió de un negocio suyo.",
  },
};

/** Qué se hace con un cliente en la lista 69-B del SAT. */
export const POLITICAS_69B = ["nada", "avisar", "bloquear"] as const;
export type Politica69b = (typeof POLITICAS_69B)[number];

export const POLITICA_69B_LABELS: Record<Politica69b, string> = {
  nada: "No hacer nada",
  avisar: "Avisar en su ficha",
  bloquear: "Bloquear contratos y tickets nuevos",
};

/** El SLA de fábrica: el que prometía la constante `SLA_HOURS` antes de la 0038. */
export const SLA_HORAS_DE_FABRICA = 2;

/**
 * ¿Qué toca hacer con este estatus de la lista 69-B, según la política?
 *
 * Solo `presunto` y `definitivo` tienen política: `desvirtuado` y
 * `sentencia_favorable` son justamente el final en que el contribuyente
 * demostró que sí operaba, y tratarlo igual que al que no lo hizo sería
 * castigar al que ganó. `no_listado`, nada.
 */
export function decision69b(
  estatus: string | null | undefined,
  politica: { presunto: Politica69b; definitivo: Politica69b },
): Politica69b {
  if (estatus === "presunto") return politica.presunto;
  if (estatus === "definitivo") return politica.definitivo;
  return "nada";
}
