/**
 * EL DOMICILIO FISCAL MEXICANO, EN UN SOLO SITIO.
 *
 * Lo que el SAT llama `Domicilio` y esta casa guarda desarmado en
 * `crm_organizations`. Aquí viven las tres cosas que se hacen con él: escribirlo
 * para leerlo, validarlo, y desarmar el texto suelto que vino del padrón viejo.
 *
 * ── QUÉ EXIGE EL SAT, Y QUÉ NO ────────────────────────────────────────────
 *
 * En CFDI 4.0 el receptor viaja con cuatro datos: RFC, Nombre, RégimenFiscal y
 * `DomicilioFiscalReceptor`, que es EL CÓDIGO POSTAL Y NADA MÁS —cinco dígitos—.
 * Tiene que ser idéntico al que el SAT tiene registrado en la Constancia de
 * Situación Fiscal de esa empresa; si no coincide, el timbrado se rechaza, y es
 * el error más frecuente al facturar.
 *
 * El resto —calle, número exterior e interior, colonia, localidad, municipio,
 * estado, país, referencia— NO se timbra en el comprobante. Forma el nodo
 * `Domicilio` de los complementos (Carta Porte) y es el domicilio que uno
 * necesita para mandar a un técnico o para poner en un contrato. Se captura
 * porque el costo de hacerlo ahora es el mismo y el de recapturar 161 fichas
 * después, no.
 *
 * ── POR QUÉ TODO ES OPCIONAL, TAMBIÉN EL CÓDIGO POSTAL ────────────────────
 *
 * Porque un prospecto al que se le va a llamar por teléfono no tiene por qué
 * traer domicilio fiscal, y exigirlo convertiría el alta de una ficha en un
 * trámite. Lo que hace falta es que, cuando se llene, se llene BIEN: por eso el
 * código postal se valida a cinco dígitos y se rechaza si trae otra cosa, en vez
 * de guardarse a medias.
 */

import { z } from "zod";

/** Los campos del nodo `Domicilio`, con el nombre que llevan en la base. */
export type Domicilio = {
  /** SAT `Calle`. */
  street: string | null;
  /** SAT `NumeroExterior`. */
  extNumber: string | null;
  /** SAT `NumeroInterior`. */
  intNumber: string | null;
  /** SAT `Colonia`. */
  neighborhood: string | null;
  /** SAT `Localidad`. */
  locality: string | null;
  /** SAT `Municipio`. */
  municipality: string | null;
  /** SAT `Estado`. */
  state: string | null;
  /** SAT `CodigoPostal`: el único que exige el CFDI 4.0. */
  postalCode: string | null;
  /** SAT `Pais`, clave de `c_Pais`. */
  country: string | null;
  /** SAT `Referencia`. */
  addressReference: string | null;
};

export const DOMICILIO_VACIO: Domicilio = {
  street: null,
  extNumber: null,
  intNumber: null,
  neighborhood: null,
  locality: null,
  municipality: null,
  state: null,
  postalCode: null,
  country: "MEX",
  addressReference: null,
};

/* ========================= Código postal ========================= */

/**
 * Cinco dígitos, ni uno más.
 *
 * Se valida aparte del resto porque es el único que el SAT mira, y porque el
 * error típico no es dejarlo vacío sino escribirlo mal: cuatro dígitos cuando
 * empieza en cero, o con el separador de miles que le mete la hoja de cálculo.
 */
export function cpValido(v: unknown): v is string {
  return typeof v === "string" && /^\d{5}$/.test(v);
}

/**
 * Endereza un código postal escrito por una persona o por una hoja de cálculo.
 *
 * ── EL CERO DE LA IZQUIERDA ES EL PROBLEMA ────────────────────────────────
 *
 * Los códigos postales de la Ciudad de México empiezan en cero, y cualquier
 * herramienta que los trate como número se lo come: 04650 sale como 4650, y con
 * separador de miles, como «4,650». Así vinieron 143 de las 148 direcciones del
 * padrón. Rellenar con ceros a la izquierda no es una licencia: un código postal
 * mexicano tiene exactamente cinco dígitos, así que «4650» solo puede ser 04650.
 *
 * Devuelve `null` en vez de adivinar cuando queda algo que no son de uno a cinco
 * dígitos —«S/N», un rango, una fecha—, porque un CP inventado se descubre el
 * día del timbrado y para entonces ya se facturó mal.
 */
export function normalizarCp(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const soloDigitos = bruto.replace(/[\s,._-]/g, "");
  if (!/^\d{1,5}$/.test(soloDigitos)) return null;
  return soloDigitos.padStart(5, "0");
}

/**
 * El código postal COMO CAMPO DE FORMULARIO, listo para un esquema de zod.
 *
 * Vive aquí y no junto a la acción que lo usa por dos razones. La primera es
 * que un archivo `"use server"` solo puede exportar funciones asíncronas —Next
 * rompe el build si exporta un objeto—, así que el esquema no puede salir de
 * ahí ni para probarlo. La segunda es que esta es la regla del código postal
 * mexicano, no una regla de las organizaciones: el día que haya que capturar el
 * domicilio de un proveedor, es esto lo que se reusa.
 *
 * ── VALIDA SOBRE LO TECLEADO, NO SOBRE LO NORMALIZADO ─────────────────────
 *
 * `normalizarCp` devuelve nulo tanto para «» como para «S/N». Comprobar después
 * de normalizar no distingue los dos casos y deja pasar la basura como si fuera
 * un campo vacío: escribir cualquier cosa borraba el código postal en silencio.
 * Mirando el valor crudo, vacío es vacío y basura es un error con mensaje.
 */
export function campoCp() {
  return z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v && v.trim() && !cpValido(normalizarCp(v))) {
        ctx.addIssue({
          code: "custom",
          message:
            "El código postal debe tener cinco dígitos, como en la Constancia de Situación Fiscal.",
        });
      }
    })
    .transform((v) => (v && v.trim() ? normalizarCp(v) : null));
}

/* ========================= Estados ========================= */

/**
 * Los 32 estados, con sus alias reales.
 *
 * No es decoración: es lo que permite distinguir el municipio del estado en una
 * dirección de seis partes separadas por comas, que es la única pista que trae
 * el padrón viejo. Los alias salen de mirar los datos —«DISTRITO FEDERAL» sigue
 * escrito en fichas de hace años, «EDO.DE MEX.» y «Estado de México» conviven en
 * la misma tabla—, no de una lista teórica.
 */
const ESTADOS: Array<{ nombre: string; alias: string[] }> = [
  { nombre: "Aguascalientes", alias: [] },
  { nombre: "Baja California", alias: ["BC", "B.C."] },
  { nombre: "Baja California Sur", alias: ["BCS"] },
  { nombre: "Campeche", alias: [] },
  { nombre: "Chiapas", alias: [] },
  { nombre: "Chihuahua", alias: [] },
  {
    nombre: "Ciudad de México",
    // «CUIDAD DE MEXICO» no es un descuido de esta lista: está escrito así en
    // tres fichas del padrón. Un alias con la errata dentro coloca esas tres;
    // dejarlas fuera por pulcritud las mandaría a revisión a mano.
    alias: ["CDMX", "Distrito Federal", "DF", "D.F.", "Cuidad de Mexico"],
  },
  { nombre: "Coahuila", alias: ["Coahuila de Zaragoza"] },
  { nombre: "Colima", alias: [] },
  { nombre: "Durango", alias: [] },
  { nombre: "Guanajuato", alias: [] },
  { nombre: "Guerrero", alias: [] },
  { nombre: "Hidalgo", alias: [] },
  { nombre: "Jalisco", alias: [] },
  {
    nombre: "Estado de México",
    alias: [
      "México",
      "Mexico",
      "Edo. de Mex.",
      "Edo.de Mex.",
      "Edo de Mexico",
      "Edo. de México",
      "Edo Mex",
      "EDOMEX",
      "de México",
    ],
  },
  { nombre: "Michoacán", alias: ["Michoacan de Ocampo", "Michoacán de Ocampo"] },
  { nombre: "Morelos", alias: [] },
  { nombre: "Nayarit", alias: [] },
  { nombre: "Nuevo León", alias: ["NL"] },
  { nombre: "Oaxaca", alias: [] },
  { nombre: "Puebla", alias: [] },
  { nombre: "Querétaro", alias: ["Queretaro de Arteaga"] },
  { nombre: "Quintana Roo", alias: [] },
  { nombre: "San Luis Potosí", alias: ["SLP", "S.L.P."] },
  { nombre: "Sinaloa", alias: [] },
  { nombre: "Sonora", alias: [] },
  { nombre: "Tabasco", alias: [] },
  { nombre: "Tamaulipas", alias: [] },
  { nombre: "Tlaxcala", alias: [] },
  { nombre: "Veracruz", alias: ["Veracruz de Ignacio de la Llave"] },
  { nombre: "Yucatán", alias: [] },
  { nombre: "Zacatecas", alias: [] },
];

/** Sin acentos, sin puntos y en minúsculas: así se teclea con prisa. */
const clave = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.\s]+/g, " ")
    .trim();

/*
  Se indexa DOS VECES cada nombre: con espacios y sin ellos.

  Las abreviaturas del padrón llevan puntos pegados de cualquier manera —«S.L.P.»,
  «B.C.», «EDO.DE MEX.»— y no hay una sola forma de partirlas que sirva para las
  tres. Guardar también la versión sin espacios hace que «S.L.P.» y «SLP» caigan
  en la misma casilla sin tener que enumerar cada puntuación posible.
*/
const POR_CLAVE = new Map<string, string>();
const indexar = (texto: string, nombre: string) => {
  const k = clave(texto);
  POR_CLAVE.set(k, nombre);
  POR_CLAVE.set(k.replace(/ /g, ""), nombre);
};
for (const e of ESTADOS) {
  indexar(e.nombre, e.nombre);
  for (const a of e.alias) indexar(a, e.nombre);
}

/** Lista para poblar un desplegable, en el orden en que se lee una lista. */
export const ESTADOS_MX = ESTADOS.map((e) => e.nombre).sort((a, b) =>
  a.localeCompare(b, "es"),
);

/** El nombre canónico del estado, o `null` si ese texto no es un estado. */
export function estadoCanonico(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const k = clave(bruto);
  return POR_CLAVE.get(k) ?? POR_CLAVE.get(k.replace(/ /g, "")) ?? null;
}

/* ========================= Escribirlo ========================= */

/**
 * El domicilio en una línea, para leerlo.
 *
 * En el orden en que se dicta una dirección en México: calle y número, interior,
 * colonia, municipio, estado, CP. Se saltan los vacíos sin dejar comas huérfanas
 * —«CALLE, , COLONIA» se lee como un error de captura, y aquí lo sería—.
 *
 * El país no se escribe cuando es México: nadie dicta «…, MEX» y ponerlo haría
 * ruido en las 161 fichas para servir a ninguna.
 */
export function domicilioEnUnaLinea(d: Partial<Domicilio>): string | null {
  const calleYNumero = [d.street, d.extNumber].filter(Boolean).join(" ");
  const partes = [
    calleYNumero || null,
    d.intNumber ? `Int. ${d.intNumber}` : null,
    d.neighborhood,
    d.locality,
    d.municipality,
    d.state,
    d.postalCode ? `C.P. ${d.postalCode}` : null,
    d.country && d.country !== "MEX" ? d.country : null,
  ].filter((p): p is string => Boolean(p && String(p).trim()));

  return partes.length > 0 ? partes.join(", ") : null;
}

/** ¿Hay algo capturado, más allá del país que viene por omisión? */
export function tieneDomicilio(d: Partial<Domicilio>): boolean {
  return domicilioEnUnaLinea(d) !== null;
}

/* ========================= Desarmarlo ========================= */

export type Desarmado = {
  domicilio: Domicilio;
  /**
   * Lo que NO se pudo colocar, en palabras.
   *
   * Existe porque degradar en silencio ya salió caro en esta casa: un importador
   * que no reconoce algo tiene que decirlo. Una dirección medio desarmada sin
   * incidencia es una que nadie va a revisar nunca.
   */
  incidencias: string[];
};

/**
 * Desarma el texto suelto del padrón viejo.
 *
 * ── LA FORMA QUE TRAE, MEDIDA, NO SUPUESTA ────────────────────────────────
 *
 * De las 148 direcciones cargadas desde SAE, 114 traen seis partes separadas por
 * «, » y 26 traen cinco. La forma es:
 *
 *     CALLE, NÚMERO, COLONIA, MUNICIPIO, ESTADO, CP     (seis)
 *     CALLE, NÚMERO, COLONIA, ESTADO, CP                (cinco, sin municipio)
 *
 * y 143 de las 148 terminan en un código postal escrito como número con
 * separador de miles («4,650» por 04650). Lo que distingue las dos formas es si
 * la penúltima parte es un estado, así que se recorre DESDE EL FINAL: primero el
 * CP, luego el estado —contra la lista, no por posición—, y lo que sobra por
 * delante se reparte. Contar desde el principio habría desalineado las 26 de
 * cinco partes sin que nadie se enterara.
 *
 * Lo que no encaja no se fuerza: se deja nulo y se anota. Cinco direcciones ya
 * se sabe que no traen código postal ninguno.
 */
export function desarmarDireccion(bruto: string | null | undefined): Desarmado {
  const d: Domicilio = { ...DOMICILIO_VACIO };
  const incidencias: string[] = [];

  const texto = (bruto ?? "").trim();
  if (!texto) return { domicilio: d, incidencias };

  const partes = texto
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (partes.length < 3) {
    incidencias.push(
      `«${texto}» no trae partes suficientes para desarmarla; queda como texto libre.`,
    );
    return { domicilio: d, incidencias };
  }

  /*
    El separador de miles del código postal REÚNE dos partes.

    «…, CIUDAD DE MÉXICO, 4,650» se parte en cuatro trozos y los dos últimos son
    «4» y «650», que por separado no son nada. Se vuelven a unir antes de mirar
    nada más; si no, el estado se buscaría en «4» y el CP saldría 00650, que es
    un código postal que existe y no es el de nadie aquí.
  */
  if (
    partes.length >= 2 &&
    /^\d{1,2}$/.test(partes[partes.length - 2]) &&
    /^\d{3}$/.test(partes[partes.length - 1])
  ) {
    const miles = partes.pop()!;
    partes[partes.length - 1] = `${partes[partes.length - 1]}${miles}`;
  }

  // 1. El código postal, al final.
  const ultima = partes[partes.length - 1];
  const cp = normalizarCp(ultima);
  if (cp) {
    d.postalCode = cp;
    partes.pop();
  } else {
    incidencias.push(
      `sin código postal reconocible al final («${ultima}»); es el único dato de domicilio que el CFDI 4.0 exige, hay que capturarlo a mano.`,
    );
  }

  // 2. El estado: contra la lista, no por posición.
  //
  // Cuando el último trozo no es un estado, se guarda igual —como municipio— y
  // se anota. Dejarlo en su sitio desalinearía todo lo que viene detrás: el
  // reparto de abajo cuenta cuántas partes quedan, y una de más corre la colonia
  // a municipio y la calle a colonia sin que nada falle a la vista.
  if (partes.length > 0) {
    const cola = partes[partes.length - 1];
    const estado = estadoCanonico(cola);
    if (estado) {
      d.state = estado;
      partes.pop();
    } else {
      d.municipality = partes.pop()!;
      incidencias.push(
        `«${cola}» no coincide con ningún estado; se guarda como municipio y el estado queda vacío.`,
      );
    }
  }

  /*
    3. Municipio y colonia, contando lo que QUEDA.

    Quitados el código postal y el estado, la forma de seis partes deja cuatro
    —calle, número, colonia, municipio— y la de cinco deja tres —calle, número,
    colonia—. Por eso el municipio pide cuatro y la colonia tres: con el umbral
    en tres para las dos, las 26 direcciones sin municipio guardaban su colonia
    en el campo del municipio y se quedaban sin colonia. Falla en silencio y solo
    se ve contando, que es lo que hace `probe-domicilio`.
  */
  if (!d.municipality && partes.length >= 4) d.municipality = partes.pop()!;
  if (partes.length >= 3) d.neighborhood = partes.pop()!;

  /*
    4. Lo que queda por delante: calle y número.

    El número es la ÚLTIMA parte que quede, y solo si parece un número —«78»,
    «12-A», «S/N», «KM 4.5»—. Una calle como «CARRETERA JOROBAS TULA» seguida de
    «MZA. 2 LT. 9» no da un número exterior limpio, así que en ese caso se deja
    todo en la calle antes que inventar un `NumeroExterior` que no lo es.
  */
  if (partes.length >= 2) {
    const posibleNumero = partes[partes.length - 1];
    if (/^(s\/n|sn|\d+[\w-]*|km\s*[\d.]+)$/i.test(posibleNumero)) {
      d.extNumber = partes.pop()!;
    }
  }
  if (partes.length > 0) d.street = partes.join(", ");

  return { domicilio: d, incidencias };
}
