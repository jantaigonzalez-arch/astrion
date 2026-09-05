/**
 * TELÉFONOS MEXICANOS: LEERLOS, ESCRIBIRLOS Y PODER MARCARLOS.
 *
 * Los 68 teléfonos que hay cargados vienen en más de veinte formas distintas
 * —«5555902555», «55 5590 2555», «2789-2000 EXT. 1112», «(555)1234567, 1234568»,
 * «5555.9025»—, y esa variedad no es un detalle estético: hace que la columna de
 * una tabla no se pueda leer en vertical y que el enlace `tel:` marque cualquier
 * cosa.
 *
 * ── NO SE RECHAZA NADA, SE ENTIENDE LO QUE SE PUEDA ───────────────────────
 *
 * Al revés que el código postal, aquí no hay nada regulatorio en juego: un campo
 * de teléfono con dos números y una extensión es un dato legítimo de una
 * recepción de hospital, no un error de captura. Así que esto no valida ni
 * bloquea: normaliza lo que reconoce, deja intacto lo que no, y AVISA de lo que
 * quedó a medias para que alguien pueda arreglarlo si quiere.
 *
 * ── LO QUE NO SE INVENTA: LA LADA ─────────────────────────────────────────
 *
 * Desde 2019 todos los números de México tienen diez dígitos. Quedan cargados
 * varios de ocho, que son de la época en que la Ciudad de México marcaba sin
 * lada. Sería fácil ponerles «55» mirando su código postal, y no se hace: un
 * código postal mal puesto pasa desapercibido hasta el timbrado, pero una lada
 * inventada hace que alguien llame a un desconocido creyendo que llama a su
 * cliente. Se marcan como incompletos y se dejan como están.
 */

/**
 * Las cuatro ladas de dos dígitos del país.
 *
 * El resto son de tres. Es lo único que decide si un número de diez dígitos se
 * agrupa «55 5590 2555» o «999 123 4567», y no hay forma de deducirlo del
 * número: hay que saberlo.
 */
const LADAS_DE_DOS = new Set(["55", "56", "33", "81"]);

/** Un número dentro del campo, ya entendido. */
export type Telefono = {
  /** Como se lee: «55 5590 2555». Nunca vacío. */
  legible: string;
  /** Para el atributo `href` de un enlace `tel:`. Nulo si no se puede marcar. */
  marcable: string | null;
  /** «1112», o null. */
  extension: string | null;
  /** Qué le falta para estar completo, o null si está bien. */
  aviso: string | null;
};

/** Agrupa diez dígitos nacionales según su lada. */
function agrupar(diez: string): string {
  const lada = diez.slice(0, 2);
  return LADAS_DE_DOS.has(lada)
    ? `${lada} ${diez.slice(2, 6)} ${diez.slice(6)}`
    : `${diez.slice(0, 3)} ${diez.slice(3, 6)} ${diez.slice(6)}`;
}

/**
 * Entiende UN número suelto, ya separado de sus hermanos.
 *
 * El orden importa: primero se aparta la extensión —si no, sus dígitos se
 * sumarían a los del número y un teléfono de diez con extensión de cuatro
 * parecería uno internacional de catorce—.
 */
function leerUno(bruto: string): Telefono | null {
  const texto = bruto.trim();
  if (!texto) return null;

  // La extensión, fuera antes de contar nada.
  const conExt = texto.match(/\b(?:ext|extensi[oó]n|x)\.?\s*(\d{1,6})/i);
  const extension = conExt ? conExt[1] : null;
  const sinExt = conExt ? texto.replace(conExt[0], " ") : texto;

  const digitos = sinExt.replace(/\D/g, "");
  /*
    Que venga escrito con «+» cambia lo que significa.

    Sin «+», un número de once dígitos que empieza en 1 es de aquí: es el «1» que
    se anteponía a los móviles antes de 2019, escrito sin la lada de país. Hay
    cuatro así en el padrón —«13333455200» es Guadalajara, «14422179661» es
    Querétaro—. Con «+», en cambio, «+1…» es Estados Unidos y hay que respetarlo.

    Sin esta distinción los cuatro salían como `tel:+1…`: marcaban a Estados
    Unidos. Un enlace que no falla, que no avisa, y que llama a un desconocido.
  */
  const explicitamenteInternacional = /\+/.test(sinExt);

  // Sin un solo dígito no es un teléfono. Se devuelve tal cual —«ESTADO DE
  // MEXICO» está escrito en el teléfono de una ficha, y esconderlo haría que
  // nadie lo corrigiera nunca— pero sin enlace para marcar.
  if (digitos.length === 0) {
    return {
      legible: texto,
      marcable: null,
      extension,
      aviso: "no parece un teléfono",
    };
  }

  /*
    SE QUITAN LOS PREFIJOS QUE YA NO SE MARCAN, EN ORDEN.

    Los tres cambiaron con la marcación de 2019 y los tres siguen escritos en
    las agendas de las que salió este padrón:

      «01»  el prefijo de larga distancia nacional. Está en dieciséis de los
            sesenta y ocho: «01 444 8133985», «0133-3345-5100», «01800.5030.909».
      «52»  la lada de país, cuando viene pegada delante de los diez dígitos.
      «1»   el que se añadía a los móviles después del 52. Marcar con él ya no
            conecta.

    Se quitan en cadena porque conviven: «01 52 33 3678 1600» los trae los dos.
    Y solo se quitan si lo que queda son DIEZ dígitos exactos —la longitud es la
    prueba de que era un prefijo y no parte del número—; sin esa condición,
    cualquier teléfono que empiece en 01 perdería sus dos primeras cifras.
  */
  const sinPrefijo = (d: string): string => {
    if (d.length === 12 && d.startsWith("01")) return sinPrefijo(d.slice(2));
    if (d.length === 12 && d.startsWith("52")) return d.slice(2);
    if (d.length === 13 && d.startsWith("521")) return d.slice(3);
    if (d.length === 14 && d.startsWith("0152")) return d.slice(4);
    // El «1» de los móviles, suelto y sin lada de país. Solo cuando nadie
    // escribió un «+»: con él, «+1» es Estados Unidos.
    if (d.length === 11 && d.startsWith("1") && !explicitamenteInternacional) {
      return d.slice(1);
    }
    return d;
  };
  const nacional = sinPrefijo(digitos);

  if (nacional.length === 10) {
    return {
      legible: agrupar(nacional),
      marcable: `+52${nacional}`,
      extension,
      aviso: null,
    };
  }

  if (nacional.length === 8) {
    return {
      legible: `${nacional.slice(0, 4)} ${nacional.slice(4)}`,
      marcable: null,
      extension,
      aviso: "le falta la lada",
    };
  }

  /*
    Más largo que diez y no es México: se asume internacional y se deja marcar,
    pero sin agrupar —cada país agrupa a su manera y agrupar a la mexicana un
    número alemán lo vuelve ilegible para quien lo tiene que leer—.

    Con una condición: E.164 NO ADMITE UN CERO DELANTE. Un número que empieza en
    cero y no encajó en ninguno de los prefijos de arriba lleva algo que no se
    entendió, y `tel:+0…` es un enlace que el marcador rechaza. Se enseña, no se
    enlaza, y se avisa.
  */
  if (nacional.length > 10) {
    if (nacional.startsWith("0")) {
      return {
        legible: sinExt.trim(),
        marcable: null,
        extension,
        aviso: "empieza en cero y no se pudo interpretar",
      };
    }
    return {
      legible: sinExt.trim(),
      marcable: `+${nacional}`,
      extension,
      aviso: null,
    };
  }

  return {
    legible: sinExt.trim(),
    marcable: null,
    extension,
    aviso: `tiene ${digitos.length} dígitos y un teléfono mexicano tiene diez`,
  };
}

/**
 * Todos los números que haya en un campo.
 *
 * ── QUÉ SEPARA DOS NÚMEROS Y QUÉ NO ───────────────────────────────────────
 *
 * Separan la coma, el punto y coma y la barra, que es como los escribe quien
 * captura las dos líneas de una recepción.
 *
 * El punto NO separa: «5555.9025» es un número escrito con puntos, no dos.
 *
 * Un espacio TAMPOCO —«55 5590 2555» es uno solo—, pero DOS O MÁS sí. Es el
 * hueco que deja quien apunta dos números sin usar puntuación, y hay uno así en
 * el padrón: «22-29-13-93    5889-76060». Sin esta regla los dos se pegaban en
 * un blob de quince dígitos que salía como número internacional y producía
 * `tel:+22291393588976060`, un enlace que marca a ninguna parte.
 */
export function leerTelefonos(bruto: string | null | undefined): Telefono[] {
  if (!bruto?.trim()) return [];
  return bruto
    .split(/[,;/]|\s{2,}/)
    .map(leerUno)
    .filter((t): t is Telefono => t !== null);
}

/** Para pintar: todos los números del campo, legibles, separados por punto medio. */
export function telefonoLegible(bruto: string | null | undefined): string | null {
  const nums = leerTelefonos(bruto);
  if (nums.length === 0) return null;
  return nums
    .map((t) => (t.extension ? `${t.legible} ext. ${t.extension}` : t.legible))
    .join(" · ");
}

/**
 * El `href` de un enlace `tel:`, o null si no hay nada marcable.
 *
 * Devuelve SIEMPRE el primero de los números del campo: un enlace solo puede
 * llevar a un sitio, y el primero es el principal por convención de quien captura.
 * Devolver null cuando no se puede marcar es lo que evita pintar un enlace que
 * no hace nada, que es peor que no pintarlo.
 */
export function telHref(bruto: string | null | undefined): string | null {
  const primero = leerTelefonos(bruto).find((t) => t.marcable);
  if (!primero?.marcable) return null;
  // La extensión viaja en el propio `tel:` con coma, que es la pausa que
  // entienden los marcadores del teléfono y de la computadora.
  return primero.extension
    ? `tel:${primero.marcable},${primero.extension}`
    : `tel:${primero.marcable}`;
}

/** Lo que le falta al campo, en una frase, o null si está todo bien. */
export function avisoDelTelefono(bruto: string | null | undefined): string | null {
  const avisos = leerTelefonos(bruto)
    .map((t) => t.aviso)
    .filter((a): a is string => a !== null);
  return avisos.length > 0 ? [...new Set(avisos)].join("; ") : null;
}

/**
 * Cómo se guarda lo que alguien acaba de teclear.
 *
 * Se normaliza lo que se entiende y se deja tal cual lo que no. Guardar el
 * formato bonito —y no los dígitos pelados— es deliberado: este campo lo lee
 * gente, lo exporta a Excel y lo pega en correos, y ahí «5555902555» obliga a
 * contar dígitos con el dedo. El `tel:` no necesita que la base esté pelada,
 * porque `telHref` lo vuelve a limpiar cada vez.
 */
export function normalizarTelefono(bruto: string | null | undefined): string | null {
  const texto = bruto?.trim();
  if (!texto) return null;
  return telefonoLegible(texto) ?? texto;
}
