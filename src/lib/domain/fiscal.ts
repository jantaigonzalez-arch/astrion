/**
 * EL EXPEDIENTE FISCAL DEL RECEPTOR, VALIDADO ANTES DE QUE EL PAC LO RECHACE.
 *
 * ── POR QUÉ ESTO NO ES VALIDACIÓN DE FORMULARIO ────────────────────────────
 *
 * Desde CFDI 4.0 el SAT contrasta el nodo `Receptor` contra su padrón al
 * timbrar. Un dato mal capturado no produce una advertencia que alguien pueda
 * ignorar: produce un RECHAZO del PAC, con la factura sin emitir y el cliente
 * esperando. Los cuatro que más rechazan tienen número propio:
 *
 *   CFDI40147  el Nombre no coincide con el del padrón
 *   CFDI40148  el código postal no coincide
 *   CFDI40149  el régimen fiscal no coincide
 *   CFDI40158  el UsoCFDI no es compatible con el régimen del receptor
 *
 * Este módulo existe para hacer los cuatro IMPOSIBLES POR CONSTRUCCIÓN, y por
 * eso vive en el dominio y no en la pantalla: lo llaman por igual el alta
 * manual, la importación masiva de CSV y el alta por API. Una regla que solo
 * vigila el formulario es una regla que la importación se salta.
 *
 * ── LO QUE AQUÍ NO SE PUEDE SABER ──────────────────────────────────────────
 *
 * Nada de esto comprueba que el RFC EXISTA. Que un RFC esté bien formado y que
 * esté dado de alta en el padrón son dos preguntas distintas, y la segunda solo
 * la contesta el SAT. Esa vive en `ValidadorFiscal` (el puerto del validador) y
 * su respuesta se guarda como estado del cliente, no como resultado de esta
 * función. Confundirlas sería prometer un cumplimiento que no se tiene.
 */

/* ────────────────────────────────────────────────────────────────────────────
   RFC
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Persona moral: 3 letras + 6 dígitos de fecha + 3 de homoclave.
 * Persona física: 4 letras + 6 dígitos de fecha + 3 de homoclave.
 *
 * `Ñ` y `&` son válidos en las letras iniciales —hay razones sociales con las
 * dos— y por eso no basta con `[A-Z]`.
 */
const RFC_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{2}[A-Z\d]$/;
const RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{2}[A-Z\d]$/;

/**
 * Los dos RFC genéricos del SAT.
 *
 * No son RFC de nadie: son comodines que el propio SAT define para el público
 * en general y para residentes en el extranjero. No se validan contra el padrón
 * —no están en él— y su dígito verificador no cumple el algoritmo general, así
 * que se reconocen antes de cualquier otra comprobación.
 */
export const RFC_PUBLICO_GENERAL = "XAXX010101000";
export const RFC_EXTRANJERO = "XEXX010101000";

export function esRfcGenerico(rfc: string): boolean {
  const r = rfc.trim().toUpperCase();
  return r === RFC_PUBLICO_GENERAL || r === RFC_EXTRANJERO;
}

/**
 * El diccionario del dígito verificador, tal como lo define el SAT.
 *
 * El orden NO es alfabético y no es un descuido: `&` va entre la `N` y la `O`, y
 * el espacio y la `Ñ` van al final con los valores 37 y 38. Ese orden es el
 * algoritmo; reordenarlo «para que se vea bien» cambia todos los dígitos.
 */
const DICCIONARIO = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";

/**
 * Calcula el dígito verificador (el último carácter) de un RFC.
 *
 * La cadena sin el dígito se alinea a DOCE posiciones rellenando con espacios
 * por la izquierda: así el mismo cálculo sirve para morales (11 caracteres
 * útiles) y físicas (12). El espacio no es relleno inerte —vale 37 en el
 * diccionario— pero como multiplica en las posiciones altas y el resultado se
 * toma módulo 11, el SAT lo define exactamente así.
 */
export function digitoVerificadorRfc(rfc: string): string | null {
  const limpio = rfc.trim().toUpperCase();
  if (limpio.length < 12 || limpio.length > 13) return null;

  const base = limpio.slice(0, -1).padStart(12, " ");
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const valor = DICCIONARIO.indexOf(base[i]);
    // Un carácter fuera del diccionario hace el cálculo imposible, no cero:
    // devolver cero daría un dígito plausible para un RFC con basura dentro.
    if (valor < 0) return null;
    suma += valor * (13 - i);
  }

  const residuo = suma % 11;
  if (residuo === 0) return "0";
  if (residuo === 1) return "A";
  return String(11 - residuo);
}

/**
 * Las combinaciones que el SAT sustituye por resultar altisonantes.
 *
 * Existen de verdad: al generar un RFC, si las cuatro primeras letras forman
 * una de estas, el SAT cambia la última por una `X`. O sea que un RFC de
 * persona física que EMPIECE así está mal formado por definición.
 *
 * La lista oficial es más larga; esta es la parte que se puede escribir sin que
 * el archivo sea una ofensa impresa. Está incompleta A PROPÓSITO y el probe lo
 * dice: es una comprobación de cortesía, no una regla fiscal, y ninguna
 * decisión de timbrado depende de ella.
 */
const INCONVENIENTES = new Set([
  "BUEI", "BUEY", "CACA", "CACO", "CAGA", "CAGO", "CAKA", "COGE", "COJA",
  "COJE", "COJO", "CULO", "FETO", "GUEY", "JOTO", "KACA", "KAGO", "KOGE",
  "KULO", "MAME", "MAMO", "MEAR", "MEAS", "MEON", "MION", "MOCO", "MULA",
  "PEDA", "PEDO", "PENE", "PUTA", "PUTO", "QULO", "RATA", "RUIN",
]);

/** Los seis dígitos centrales son `AAMMDD` y tienen que ser una fecha real. */
function fechaValida(seis: string): boolean {
  const aa = Number(seis.slice(0, 2));
  const mm = Number(seis.slice(2, 4));
  const dd = Number(seis.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;

  /*
    El siglo es ambiguo —`85` puede ser 1885 o 1985— así que no se resuelve: se
    comprueba el día contra el mes usando un año bisiesto, que es el criterio
    MÁS PERMISIVO posible. Rechazar un 29 de febrero por haber supuesto el siglo
    equivocado dejaría fuera a una persona real, y eso es peor que aceptar una
    fecha que el padrón acabará rechazando de todos modos.
  */
  const diasDelMes = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dd <= diasDelMes[mm - 1];
}

export type TipoPersona = "fisica" | "moral" | "extranjero";

export type ResultadoRfc = {
  ok: boolean;
  /** El RFC normalizado: sin espacios, sin guiones, en mayúsculas. */
  rfc: string;
  /** Derivado de la longitud. Nunca se le pregunta al usuario. */
  tipo: TipoPersona | null;
  generico: boolean;
  /** Códigos de error, para que la API pueda contestar por campo. */
  errores: string[];
};

/**
 * Valida un RFC y deriva de él el tipo de persona.
 *
 * El tipo NO se captura: son 12 caracteres para una moral y 13 para una física,
 * y preguntárselo al usuario solo abre la puerta a que no coincidan. Si algún
 * día hay que corregirlo, se corrige el RFC.
 */
export function validarRfc(entrada: string): ResultadoRfc {
  // Se quitan espacios y guiones: el padrón viejo trae «AAA-010101-AA1» y
  // rechazar eso obligaría a limpiar a mano 161 fichas.
  const rfc = entrada.trim().toUpperCase().replace(/[\s-]/g, "");
  const errores: string[] = [];

  if (!rfc) return { ok: false, rfc, tipo: null, generico: false, errores: ["rfc_vacio"] };

  if (esRfcGenerico(rfc)) {
    return {
      ok: true,
      rfc,
      tipo: rfc === RFC_EXTRANJERO ? "extranjero" : "moral",
      generico: true,
      errores: [],
    };
  }

  const esMoral = RFC_MORAL.test(rfc);
  const esFisica = RFC_FISICA.test(rfc);

  if (!esMoral && !esFisica) {
    errores.push(rfc.length === 12 || rfc.length === 13 ? "rfc_formato" : "rfc_longitud");
    return { ok: false, rfc, tipo: null, generico: false, errores };
  }

  const tipo: TipoPersona = esFisica ? "fisica" : "moral";
  const inicio = rfc.slice(0, esFisica ? 4 : 3);
  const fecha = rfc.slice(esFisica ? 4 : 3, esFisica ? 10 : 9);

  if (!fechaValida(fecha)) errores.push("rfc_fecha_invalida");
  if (esFisica && INCONVENIENTES.has(inicio)) errores.push("rfc_palabra_inconveniente");

  const esperado = digitoVerificadorRfc(rfc);
  if (esperado !== null && esperado !== rfc.slice(-1)) errores.push("rfc_digito_verificador");

  return { ok: errores.length === 0, rfc, tipo, generico: false, errores };
}

/* ────────────────────────────────────────────────────────────────────────────
   NOMBRE FISCAL
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Los regímenes de capital que hay que QUITAR del nombre.
 *
 * ── POR QUÉ SE QUITAN, QUE ES LO QUE NADIE ESPERA ──────────────────────────
 *
 * Porque el SAT no los tiene. En la Constancia de Situación Fiscal la razón
 * social viene SIN el régimen de capital, y `Receptor@Nombre` tiene que
 * coincidir con ella EXACTAMENTE. «COMERCIALIZADORA EJEMPLO, S.A. DE C.V.» es
 * como se llama la empresa en el mundo y como viene en su papelería; lo que hay
 * que timbrar es «COMERCIALIZADORA EJEMPLO». Escribir el nombre completo es la
 * causa número uno del CFDI40147.
 *
 * Se listan en forma canónica —sin puntos, mayúsculas, un espacio entre
 * palabras— y se comparan contra el final del nombre en esa misma forma, para
 * que dé igual si vino como `S.A. de C.V.`, `SA DE CV` o `S. A. de C. V.`.
 *
 * De más larga a más corta: si «SAPI DE CV» se probara después de «SA», no
 * llegaría nunca a probarse.
 */
const REGIMENES_DE_CAPITAL = [
  "SAPI DE CV SOFOM ENR",
  "SAPIB DE CV",
  "SAB DE CV",
  "SAPI DE CV",
  "SPR DE RL DE CV",
  "S DE RL DE CV",
  "SA DE CV",
  "SC DE RL DE CV",
  "SPR DE RL",
  "S DE RL",
  "S EN NC",
  "S EN CS",
  "S EN C",
  "SOFOM ENR",
  "SOFOM",
  "SAPI",
  "SNC",
  "SCL",
  "SCP",
  "SAS",
  "SRL",
  "SSS",
  "SA",
  "SC",
  "AC",
  "IAP",
  "ABP",
]
  .map((s) => s.split(" "))
  .sort((a, b) => b.length - a.length);

/** Un token sin puntos ni comas, para comparar contra la lista canónica. */
const canon = (token: string) => token.replace(/[.,]/g, "");

export type NombreFiscal = {
  /** Lo que se va a timbrar en `Receptor@Nombre`. */
  normalizado: string;
  /** Lo que tecleó la persona, intacto, para poder explicar el cambio. */
  capturado: string;
  /** El régimen de capital que se quitó, si se quitó alguno. */
  regimenRemovido: string | null;
};

/**
 * Deja el nombre como el SAT lo espera.
 *
 * 1. Recorta y colapsa espacios.
 * 2. Sube a mayúsculas CONSERVANDO acentos y `Ñ` — el padrón los tiene, y
 *    quitarlos provocaría el mismo rechazo que se intenta evitar.
 * 3. Quita el régimen de capital del final, todas las veces que haga falta.
 * 4. Quita la coma que solía separarlo.
 *
 * No toca nada más. En particular NO quita puntos ni acentos del cuerpo del
 * nombre: «GRUPO S.A.I. DEL NORTE» lleva esos puntos en la constancia.
 */
export function normalizarNombreFiscal(entrada: string): NombreFiscal {
  const capturado = entrada ?? "";
  let tokens = capturado.trim().replace(/\s+/g, " ").toUpperCase().split(" ").filter(Boolean);

  let removido: string[] = [];
  let siguio = true;

  while (siguio && tokens.length > 0) {
    siguio = false;
    for (const sufijo of REGIMENES_DE_CAPITAL) {
      if (tokens.length <= sufijo.length) continue; // nunca dejar el nombre vacío
      const cola = tokens.slice(-sufijo.length).map(canon);
      if (cola.every((t, i) => t === sufijo[i])) {
        removido = tokens.slice(-sufijo.length).concat(removido);
        tokens = tokens.slice(0, -sufijo.length);
        siguio = true;
        break;
      }
    }
  }

  // La coma que separaba el régimen se queda huérfana: «EJEMPLO,» → «EJEMPLO».
  if (tokens.length) tokens[tokens.length - 1] = tokens[tokens.length - 1].replace(/,+$/, "");

  return {
    normalizado: tokens.join(" ").trim(),
    capturado,
    regimenRemovido: removido.length ? removido.join(" ") : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   CURP
   ──────────────────────────────────────────────────────────────────────────── */

const CURP_FORMA = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

/**
 * Valida una CURP, incluido su dígito verificador.
 *
 * El dígito de la CURP NO usa el mismo algoritmo que el del RFC: aquí el
 * diccionario es «0-9 A-Z» sin `&` ni `Ñ`, los pesos van de 18 a 2, y el
 * resultado es `10 - (suma % 10)` módulo 10. Son dos algoritmos distintos para
 * dos identificadores distintos, y mezclarlos da dígitos plausibles y falsos.
 */
export function validarCurp(entrada: string): { ok: boolean; curp: string; errores: string[] } {
  const curp = entrada.trim().toUpperCase().replace(/\s/g, "");
  if (!curp) return { ok: false, curp, errores: ["curp_vacia"] };
  if (!CURP_FORMA.test(curp)) return { ok: false, curp, errores: ["curp_formato"] };
  if (!fechaValida(curp.slice(4, 10))) return { ok: false, curp, errores: ["curp_fecha_invalida"] };

  const dicc = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  let suma = 0;
  for (let i = 0; i < 17; i++) {
    const valor = dicc.indexOf(curp[i]);
    if (valor < 0) return { ok: false, curp, errores: ["curp_caracter_invalido"] };
    suma += valor * (18 - i);
  }
  const esperado = String((10 - (suma % 10)) % 10);

  return esperado === curp[17]
    ? { ok: true, curp, errores: [] }
    : { ok: false, curp, errores: ["curp_digito_verificador"] };
}
