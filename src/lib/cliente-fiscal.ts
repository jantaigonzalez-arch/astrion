/**
 * EL SEMÁFORO FISCAL DE UN CLIENTE. UNA SOLA VEZ, PARA LA LISTA Y PARA LA FICHA.
 *
 * ── POR QUÉ VIVE AQUÍ Y NO EN CADA PANTALLA ────────────────────────────────
 *
 * Porque dos pantallas que calculan el mismo estado por su cuenta acaban
 * discrepando, y el día que discrepan nadie sabe cuál creer. En este mismo
 * repositorio ya pasó con algo más caro: `/acceso` y el layout del portal
 * preguntaban cada uno lo suyo sobre la misma sesión, y la diferencia entre las
 * dos preguntas era un bucle infinito de redirecciones.
 *
 * Aquí la consecuencia sería más silenciosa y por eso peor: la lista diría que
 * un cliente está listo para facturar y la ficha que no, o al revés.
 *
 * ── POR QUÉ CUATRO ESTADOS Y NO DOS ────────────────────────────────────────
 *
 * «Listo / no listo» escondería la distinción que decide el trabajo. Un cliente
 * SIN expediente y uno CON expediente sin validar están los dos «no listos»,
 * pero al primero hay que capturarle el régimen y el código postal y al segundo
 * basta con validarlo. Un solo rojo para los dos manda a todo el mundo a abrir
 * la ficha para averiguar cuál de los dos es.
 *
 * Y verde significa QUE EL SAT DIJO QUE SÍ, no que los datos se vean bien.
 */

/** Lo mínimo que hace falta para decidir el estado. */
export type DatosDelSemaforo = {
  /** RFC del expediente fiscal. Nulo si la ficha todavía no lo tiene. */
  rfcFiscal: string | null;
  /** RFC heredado del padrón de SAE. Sirve para buscar, no para facturar. */
  taxId: string | null;
  /** `no_validado` | `valido` | `rfc_inexistente` | … | nulo si nunca se validó. */
  validacion: string | null;
};

export type EstadoFiscal = {
  texto: string;
  /** Clases del `Badge`. Verde solo cuando el SAT confirmó. */
  clase: string;
  /** Qué significa y qué hacer. Va como `title`, y en la ficha a la vista. */
  ayuda: string;
  /** `true` cuando se le puede timbrar con confianza. Lo usa quien decida bloquear. */
  listo: boolean;
};

export function estadoFiscal(c: DatosDelSemaforo): EstadoFiscal {
  if (!c.rfcFiscal) {
    return {
      texto: "Sin expediente",
      clase: "bg-muted/40 text-muted-foreground ring-border",
      ayuda: c.taxId
        ? "Tiene RFC del padrón viejo, pero le faltan el régimen fiscal y el código " +
          "postal de la Constancia. Con eso no se puede timbrar."
        : "No tiene ni RFC. No se le puede facturar.",
      listo: false,
    };
  }

  switch (c.validacion) {
    case "valido":
      return {
        texto: "Validado",
        clase: "bg-success/10 text-success ring-success/30",
        ayuda: "El SAT confirmó RFC, nombre y código postal.",
        listo: true,
      };
    case "rfc_inexistente":
      return {
        texto: "RFC inexistente",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "El SAT no encuentra ese RFC en su padrón.",
        listo: false,
      };
    case "nombre_no_coincide":
      return {
        texto: "Nombre no coincide",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda:
          "CFDI40147: el nombre no es el de la Constancia de Situación Fiscal. " +
          "Suele ser el régimen de capital (S.A. de C.V.) sobrando.",
        listo: false,
      };
    case "cp_no_coincide":
      return {
        texto: "CP no coincide",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda:
          "CFDI40148: el código postal no es el de la Constancia. " +
          "Revisa que no se haya capturado el de entrega.",
        listo: false,
      };
    case "error":
      return {
        texto: "Error al validar",
        clase: "bg-destructive/10 text-destructive ring-destructive/30",
        ayuda: "La última validación no se pudo completar. Vuelve a intentarlo.",
        listo: false,
      };
    default:
      /*
        `no_validado`, nulo, y cualquier valor que no se reconozca.

        Lo desconocido cae aquí y NO en un estado de error a propósito: si algún
        día el enum crece, un cliente con un estado nuevo tiene que salir como
        «pendiente de validar» —que es cierto— y no como «error», que sería una
        acusación inventada por no haber actualizado esta función.
      */
      return {
        texto: "Sin validar",
        clase: "bg-warning/10 text-warning ring-warning/30",
        ayuda:
          "El expediente está capturado, pero nadie lo ha contrastado contra el padrón " +
          "del SAT. El nombre y el código postal solo los confirma el SAT.",
        listo: false,
      };
  }
}
