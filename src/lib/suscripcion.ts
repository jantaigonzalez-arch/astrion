import type { tenantStatus } from "@/lib/db/platform";

/** Los cuatro estados de `tenants.status`, derivados del enum del esquema. */
export type EstadoInquilino = (typeof tenantStatus)["enumValues"][number];

/**
 * QUIÉN PUEDE ENTRAR, Y HASTA CUÁNDO.
 *
 * ── SIN CLIENTE DE PAGOS TODAVÍA ──────────────────────────────────────────
 *
 * Este archivo no habla con Stripe ni con nadie. Decide, a partir del estado
 * del inquilino y de la fecha de fin de prueba, si la empresa entra o no entra.
 * Es el paso que tiene que existir ANTES del cobro: sin él, dejar de pagar no
 * tiene ninguna consecuencia y cobrar es una formalidad.
 *
 * Cuando llegue la pasarela, lo único que cambiará es QUIÉN mueve
 * `tenants.status` —hoy una persona desde la consola, mañana un webhook—. La
 * regla de quién entra se queda aquí, escrita una sola vez.
 *
 * ── SIN `use client`, SIN BASE DE DATOS ───────────────────────────────────
 *
 * Recibe los dos campos y devuelve una respuesta. Así lo puede usar el guardia
 * del portal, la tarjeta de configuración, la consola de Astraion y un probe,
 * sin que ninguno tenga que repetir la aritmética de los días.
 */

/* ============================== Los planes ============================== */

/**
 * PLANETAS.
 *
 * Astraion es una estrella; lo que orbita a su alrededor son planetas, y cada
 * plan es uno. La escala natural es la distancia: cuanto más lejos, más grande
 * es el mundo. Eso deja sitio para crecer en las dos direcciones sin renombrar
 * nada —hacia dentro Mercurio y Venus para algo más chico, hacia fuera Marte y
 * Júpiter para más— y sin que el nombre prometa un tamaño que no corresponde.
 *
 * Hoy hay uno solo: **Tierra**, que es el planeta donde hay operación. Es el
 * plan ESTÁNDAR —la pantalla lo dice con esa palabra— porque es lo que recibe
 * quien contrata: el sistema completo, sin recortes ni módulos que se compren
 * aparte. `escalon` es lo que se lee en la tarjeta; `nombre` es cómo se llama.
 *
 * ── EL PRECIO VA EN DÓLARES ───────────────────────────────────────────────
 *
 * Es como se decidió venderlo. Queda anotado que COBRAR en dólares a una
 * tarjeta mexicana no lo permite una cuenta de Stripe México: cuando llegue la
 * pasarela habrá que fijar el importe en pesos al tipo de cambio del día, o
 * abrir la cuenta en otro país. Lo que se muestra aquí es el precio de lista,
 * que es una decisión comercial y no un detalle de la pasarela.
 */
export const PLANES = {
  tierra: {
    nombre: "Tierra",
    /** Cómo se nombra el nivel en la pantalla. Ver la nota de arriba. */
    escalon: "Estándar",
    lema: "El sistema completo: servicio, ventas, compras y análisis.",
    /** Al mes, ANTES de IVA. */
    precioUsd: 320,
  },
} as const;

export type PlanId = keyof typeof PLANES;

/**
 * El precio, escrito de forma que no se pueda leer mal.
 *
 * «$320» a secas es 320 PESOS para cualquiera que lo lea en México —el símbolo
 * es el mismo en las dos monedas— y esta es una pantalla que pide dinero: un
 * malentendido de 17 a 1 no se descubre hasta que llega el cargo.
 *
 * Por eso la moneda va escrita al lado del símbolo y no se confía en el
 * formateador: `Intl` con `en-US` produce «$320», que es correcto para quien
 * lee en Estados Unidos y ambiguo para quien lee aquí.
 */
export function precioDelPlan(p: { precioUsd: number }): string {
  return `$${p.precioUsd.toLocaleString("en-US")} USD`;
}

/**
 * El plan, si se reconoce.
 *
 * `null` para lo que no esté en el catálogo —hoy `poc`, que es lo que llevan
 * los inquilinos dados de alta antes de que esto existiera—. Se devuelve nulo
 * en vez de caer a uno cualquiera: enseñar «Tierra» a quien no lo contrató
 * sería inventar un dato en la pantalla que habla de dinero.
 */
export function planDe(id: string): (typeof PLANES)[PlanId] | null {
  return (PLANES as Record<string, (typeof PLANES)[PlanId]>)[id] ?? null;
}

/* ============================ El estado ============================ */

export type EstadoSuscripcion =
  /** Prueba corriendo. `dias` es lo que queda, redondeado hacia arriba. */
  | { clave: "prueba"; entra: true; dias: number; hasta: Date }
  /** Prueba sin fecha de fin: los de antes de que esto existiera. */
  | { clave: "prueba-abierta"; entra: true }
  | { clave: "activa"; entra: true }
  | { clave: "vencida"; entra: false; hasta: Date }
  | { clave: "suspendida"; entra: false }
  | { clave: "cancelada"; entra: false };

export type DatosSuscripcion = {
  status: EstadoInquilino;
  trialEndsAt: Date | null;
  plan: string;
};

/**
 * Cuántos días enteros faltan, contando el de hoy como uno.
 *
 * Hacia ARRIBA a propósito: a quien le quedan unas horas le decimos «1 día»,
 * no «0». Cero días es lo que se le dice a quien ya no entra, y decírselo a
 * alguien que todavía puede trabajar sería alarmarlo por un redondeo.
 */
function diasHasta(fin: Date, ahora: Date): number {
  const ms = fin.getTime() - ahora.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * El estado de la suscripción, y si con él se entra.
 *
 * `ahora` se recibe en vez de leerse dentro para que un probe pueda situarse en
 * cualquier día sin tocar el reloj de la máquina — que es la única forma de
 * comprobar el vencimiento sin esperar treinta días.
 */
export function estadoDe(
  t: DatosSuscripcion,
  ahora: Date = new Date(),
): EstadoSuscripcion {
  switch (t.status) {
    case "active":
      return { clave: "activa", entra: true };
    case "suspended":
      return { clave: "suspendida", entra: false };
    case "cancelled":
      return { clave: "cancelada", entra: false };
    case "trial": {
      // Nulo = no se le acaba. Ver la nota de la columna: es lo que hace que
      // añadir esto no le cierre la puerta a nadie.
      if (!t.trialEndsAt) return { clave: "prueba-abierta", entra: true };
      if (t.trialEndsAt.getTime() > ahora.getTime()) {
        return {
          clave: "prueba",
          entra: true,
          dias: diasHasta(t.trialEndsAt, ahora),
          hasta: t.trialEndsAt,
        };
      }
      return { clave: "vencida", entra: false, hasta: t.trialEndsAt };
    }
    default:
      /*
        Un estado que esta versión no conoce NO abre la puerta.

        `status` llega de la base y el tipo describe la intención, no lo que
        puede llegar —la misma lección que dejó una fila de `viz` con un nombre
        viejo tumbando un tablero—. Ante la duda, cerrado: equivocarse hacia
        «no entra» se reporta en un minuto; hacia «entra» no se reporta nunca.
      */
      return { clave: "suspendida", entra: false };
  }
}

/** Días que dura una prueba nueva. Ver `iniciarPrueba` en la consola. */
export const DIAS_DE_PRUEBA = 30;

/**
 * A partir de cuántos días restantes conviene avisar.
 *
 * Siete, y ni uno más. Se pidió que esto fuera DISCRETO: un aviso desde el día
 * uno convierte los treinta días de prueba en treinta días de recordatorio de
 * que hay que pagar, que es exactamente la sensación que no se quiere dejar.
 *
 * Pero cero avisos tampoco: cerrarle la puerta a alguien que no vio venir nada
 * es peor que un aviso de más. Una semana da tiempo a mover un pago sin que la
 * pantalla se convierta en un cobrador.
 */
export const DIAS_PARA_AVISAR = 7;

/** ¿Toca ya mencionarlo en la tarjeta de configuración? */
export function convieneAvisar(e: EstadoSuscripcion): boolean {
  return e.clave === "prueba" && e.dias <= DIAS_PARA_AVISAR;
}
