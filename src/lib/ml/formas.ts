import type { ProjectionBlock, TrendBlock } from "@/lib/ml/blocks-types";

/**
 * Las formas que puede tomar un bloque de barras, y CUÁLES puede tomar cada uno.
 *
 * ── POR QUÉ NO BASTA CON LISTAR TIPOS DE GRÁFICA ───────────────────────────
 *
 * Un menú que ofrece pastel para doce meses, o dispersión para una sola
 * magnitud, deja elegir gráficas que mienten. Y esconder esas opciones tampoco
 * sirve: quien las busca se queda sin saber por qué no están y concluye que
 * faltan. Así que salen TODAS, y las que no aplican salen apagadas CON EL
 * MOTIVO, medido sobre los datos de ESE bloque —no sobre su tipo—.
 *
 * El motivo no es un «no disponible». Dice qué le falta al dato:
 *
 *   «una dispersión cruza dos magnitudes por punto y aquí cada barra tiene
 *    una sola»
 *
 * Eso se puede leer, discutir y, si hace falta, arreglar en el análisis. Un
 * candado gris no.
 *
 * ── LO QUE HAY EN UN BLOQUE, Y ES TODO LO QUE HAY ──────────────────────────
 *
 * `Bar[]`: N categorías, una magnitud (`value`), a veces una segunda
 * (`stacked`), a veces un estado (`alert`). Más `axis` —si el eje es el
 * tiempo— y a veces un `total`. De ahí sale todo lo que se puede afirmar.
 * Ninguna forma puede inventar una dimensión que el dato no trae: eso es
 * exactamente lo que separa «no apta» de «apta».
 */

export type Forma =
  | "columnas"
  | "ranking"
  | "linea"
  | "area"
  | "apiladas"
  | "agrupadas"
  | "cien"
  | "pastel"
  | "dona"
  | "treemap"
  | "dispersion"
  | "regresion"
  | "tabla";

/** Lo que el motor necesita saber. Sirve igual para proyección y tendencia. */
export type Datos = Pick<ProjectionBlock, "bars"> & {
  axis?: "time";
  total?: number;
  legend?: TrendBlock["legend"];
};

export type Aptitud = { apta: true } | { apta: false; motivo: string };

export const FORMA_LABEL: Record<Forma, string> = {
  columnas: "Columnas",
  ranking: "Barras horizontales",
  linea: "Línea",
  area: "Área",
  apiladas: "Columnas apiladas",
  agrupadas: "Columnas agrupadas",
  cien: "Apiladas al 100 %",
  pastel: "Pastel",
  dona: "Dona",
  treemap: "Mapa de árbol",
  dispersion: "Dispersión",
  regresion: "Línea con tendencia",
  tabla: "Tabla",
};

/** El orden en que se ofrecen. De lo más usado a lo más específico. */
export const FORMAS: Forma[] = [
  "columnas",
  "ranking",
  "linea",
  "area",
  "apiladas",
  "agrupadas",
  "cien",
  "pastel",
  "dona",
  "treemap",
  "dispersion",
  "regresion",
  "tabla",
];

/* ------------------------- Lo que se puede afirmar ------------------------- */

const esTiempo = (d: Datos) => d.axis === "time";
const dosMagnitudes = (d: Datos) => d.bars.some((b) => (b.stacked ?? 0) > 0);
const hayEstado = (d: Datos) => d.bars.some((b) => b.alert);
const hayNegativos = (d: Datos) =>
  d.bars.some((b) => b.value < 0 || (b.stacked ?? 0) < 0);

/**
 * Si las barras son TODO el asunto o solo las mayores.
 *
 * Es la pregunta que decide si un pastel puede existir, y no se puede deducir
 * del tipo: «los seis clientes que más facturan» y «el reparto por categoría de
 * servicio» tienen la misma forma de dato y solo el segundo suma un total.
 *
 * La señal es `total`, que ya traen las proyecciones y significa justo eso:
 * cuánto es el todo. Si las barras lo suman —con un 2 % de holgura por los
 * redondeos de cada una—, son el reparto completo. Si no lo traen, se supone
 * que NO: es la respuesta conservadora, y la que evita el error caro, que es
 * dibujar un pastel de un top-6 y afirmar que ahí está el 100 %.
 *
 * Un análisis que sí sea un reparto y quiera su pastel solo tiene que declarar
 * su `total`, que además es información útil por su cuenta.
 */
function esRepartoCompleto(d: Datos): boolean {
  if (d.total === undefined || d.total <= 0) return false;
  const suma = d.bars.reduce((a, b) => a + b.value + (b.stacked ?? 0), 0);
  return Math.abs(suma - d.total) <= d.total * 0.02;
}

/**
 * ¿Puede este bloque dibujarse así? Y si no, ¿qué le falta?
 *
 * Cada motivo nombra la carencia concreta del dato, en una frase que se pueda
 * leer en un menú sin abrir documentación.
 */
export function aptitud(d: Datos, f: Forma): Aptitud {
  // Un nombre que este catálogo no conoce —una forma retirada, una fila escrita
  // por una versión más nueva, un valor a mano en la base— no es apto, y decirlo
  // aquí es lo que evita que el `switch` se caiga por el final devolviendo
  // `undefined`. TypeScript da el switch por exhaustivo sobre `Forma`, pero este
  // valor llega de la BASE y de un campo oculto de formulario: el tipo describe
  // la intención, no lo que de verdad puede llegar.
  if (!FORMAS.includes(f)) {
    return { apta: false, motivo: "Esa forma ya no existe en esta versión." };
  }

  const n = d.bars.length;
  const si: Aptitud = { apta: true };
  const no = (motivo: string): Aptitud => ({ apta: false, motivo });

  if (n === 0) return no("Hoy este análisis no trae datos que dibujar.");

  switch (f) {
    /* Las dos que siempre sirven: una magnitud por categoría es exactamente
       lo que una barra sabe representar, en cualquier orientación. */
    case "columnas":
    case "ranking":
      return si;

    /* La tabla nunca sobra, y es la salida cuando ninguna gráfica convence.
       También es la que garantiza que el dato se pueda leer exacto. */
    case "tabla":
      return si;

    case "linea":
      if (!esTiempo(d))
        return no(
          "Una línea une puntos consecutivos y afirma que hay camino entre " +
            "ellos. Estas categorías no tienen orden: la pendiente no diría nada.",
        );
      if (n < 3) return no("Con menos de tres periodos no hay curva que enseñar.");
      return si;

    case "area":
      if (!esTiempo(d))
        return no(
          "El área es una línea rellena, y hereda su problema: estas " +
            "categorías no van hacia ningún lado.",
        );
      if (n < 3) return no("Con menos de tres periodos no hay curva que rellenar.");
      if (dosMagnitudes(d))
        return no(
          "El relleno llega hasta la base, así que con dos magnitudes una " +
            "taparía a la otra. Para dos, apiladas.",
        );
      if (hayNegativos(d))
        return no(
          "Hay valores negativos: el relleno cambiaría de lado y se leería " +
            "como magnitud en vez de como signo.",
        );
      return si;

    case "apiladas":
    case "agrupadas":
      if (!dosMagnitudes(d))
        return no(
          "Solo hay una magnitud por categoría: no hay una segunda que apilar " +
            "ni con la que comparar.",
        );
      return si;

    case "cien":
      if (!dosMagnitudes(d))
        return no("Solo hay una magnitud: su parte del total sería siempre 100 %.");
      if (hayNegativos(d))
        return no(
          "Hay valores negativos, y un porcentaje del total exige que las " +
            "partes sumen algo positivo.",
        );
      return si;

    case "pastel":
    case "dona":
      if (esTiempo(d))
        return no(
          "El tiempo tiene orden y un pastel lo pierde: los periodos " +
            "quedarían como porciones sin secuencia.",
        );
      if (hayNegativos(d))
        return no("Hay valores negativos y una porción no puede ser negativa.");
      if (!esRepartoCompleto(d))
        return no(
          "Estas barras son las mayores, no todas. Un pastel afirmaría que " +
            "suman el total, y no es cierto.",
        );
      if (n > 6)
        return no(
          `Son ${n} porciones. Pasando de seis dejan de poder compararse entre ` +
            "sí y hay que ir a la leyenda por cada una.",
        );
      if (n < 2) return no("Una sola porción es un círculo, no un reparto.");
      return si;

    case "treemap":
      if (esTiempo(d))
        return no("Los rectángulos no tienen orden, y el tiempo sí.");
      if (hayNegativos(d))
        return no("Hay valores negativos y un rectángulo no puede tener área negativa.");
      if (!esRepartoCompleto(d))
        return no(
          "Un mapa de árbol reparte un total entre sus partes, y estas barras " +
            "no son el total: son las mayores.",
        );
      if (n < 3) return no("Con menos de tres partes, unas barras se leen mejor.");
      return si;

    case "dispersion":
      if (!dosMagnitudes(d))
        return no(
          "Una dispersión cruza DOS magnitudes por punto, y aquí cada " +
            "categoría trae una sola. Haría falta un segundo dato por categoría.",
        );
      if (n < 4) return no("Con menos de cuatro puntos no hay nube que mirar.");
      return si;

    case "regresion":
      if (!esTiempo(d))
        return no(
          "Una recta de ajuste supone que el eje avanza. Estas categorías no " +
            "avanzan hacia ningún lado, así que su pendiente sería un accidente " +
            "del orden en que salieron.",
        );
      if (dosMagnitudes(d))
        return no("El ajuste es sobre UNA magnitud; con dos no sabría a cuál seguir.");
      if (n < 6)
        return no(
          "Con menos de seis periodos la recta la decide el ruido más que el dato.",
        );
      return si;
  }
}

/**
 * La forma que le toca por omisión, deducida de lo que el bloque ES.
 *
 * Es una RECOMENDACIÓN, no un candado: el menú deja elegir cualquiera de las
 * aptas. Pero es la que se usa mientras nadie elija, y la que se marca como
 * recomendada, así que tiene que ser la correcta para el caso mayoritario.
 *
 *   ranking  el eje no es el tiempo. Entidades con nombre ordenadas por
 *            magnitud: barra horizontal, etiqueta entera, valor al lado. Es el
 *            caso mayoritario del catálogo —18 de 24—.
 *   columnas el tiempo con pocos puntos, o con dos series que se comparan
 *            periodo a periodo.
 *   linea    el tiempo, una sola serie y bastantes puntos: lo que importa es
 *            la FORMA de la evolución.
 *
 * Los estados mandan sobre todo: un bloque con tramos `alert` —lo vencido del
 * calendario de pagos— se queda en columnas aunque cumpla lo demás. El estado
 * se lee comparando una columna contra sus vecinas; disolverlo en un punto de
 * una curva pierde justo el dato que no se puede perder.
 */
export function recomendada(d: Datos): Forma {
  if (!esTiempo(d)) return "ranking";
  if (hayEstado(d)) return "columnas";
  if (dosMagnitudes(d)) return "apiladas";
  // Ocho es donde una fila de columnas empieza a leerse como textura y la
  // curva empieza a tener algo que enseñar. Por debajo, la columna gana.
  if (d.bars.length >= 8) return "linea";
  return "columnas";
}

/**
 * La forma que se dibuja de verdad: la elegida, si sigue siendo apta.
 *
 * ── POR QUÉ SE COMPRUEBA CADA VEZ ──────────────────────────────────────────
 *
 * Porque los datos cambian debajo de la elección. Alguien elige pastel en un
 * reparto de cinco categorías y el mes siguiente hay nueve: el pastel guardado
 * ya no se puede leer. Recaer en la recomendada es lo correcto —el tablero
 * sigue diciendo algo— y quien compone lo verá marcado en el menú, con el
 * motivo, la próxima vez que entre.
 *
 * Lo que NO se hace es borrar la elección guardada. Si las nueve categorías
 * eran cosa de un mes raro, al volver a cinco el pastel vuelve solo.
 */
export function formaEfectiva(d: Datos, elegida: Forma | null): Forma {
  if (elegida && aptitud(d, elegida).apta) return elegida;
  return recomendada(d);
}

/**
 * La forma guardada, saneada al entrar.
 *
 * ── DÓNDE ESTABA EL AGUJERO ───────────────────────────────────────────────
 *
 * `viz` se guarda SIN validar contra este catálogo, y a propósito: la aptitud
 * depende de los datos del bloque, que en el momento de guardar no están
 * resueltos. La apuesta era que un nombre desconocido degradara a
 * recomendación al dibujar. No degradaba: `aptitud` caía por el final del
 * `switch` devolviendo `undefined` y `formaEfectiva` reventaba leyendo `.apta`
 * —comprobado—. Como esto corre en el render del cliente, una sola fila con un
 * nombre viejo tumbaba el tablero entero para todo el que lo abriera.
 *
 * Ahora hay dos redes y las dos hacen falta: ésta convierte lo desconocido en
 * `null` al leerlo, y `aptitud` responde «no apta» en vez de nada. Una sola no
 * alcanza: por aquí entra lo que viene de la base, pero `aptitud` la llama
 * también el menú del compositor con lo que tenga en la mano.
 */
export function formaGuardada(v: string | null | undefined): Forma | null {
  return v && (FORMAS as string[]).includes(v) ? (v as Forma) : null;
}
