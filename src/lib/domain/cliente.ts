/**
 * ¿ESTE CLIENTE SE PUEDE FACTURAR? LA RESPUESTA, EN UN SOLO SITIO.
 *
 * `fiscal.ts` contesta si un RFC está bien FORMADO. Esto contesta algo distinto
 * y más útil: si el expediente entero es coherente y está completo para timbrar
 * un CFDI 4.0. Son las reglas que cruzan campos —el uso contra el régimen, el
 * país contra el RFC genérico, la sucursal contra su matriz— y las que cruzan
 * contra los catálogos del SAT.
 *
 * ── LA DISTINCIÓN QUE SOSTIENE TODO EL MÓDULO ──────────────────────────────
 *
 * Hay tres respuestas posibles y no dos:
 *
 *   ERROR         el dato está mal y se sabe. No se guarda.
 *   ADVERTENCIA   el dato podría estar mal y NO SE PUEDE SABER AQUÍ.
 *   ok            todo lo comprobable, comprobado.
 *
 * La de en medio es la que casi todos los sistemas se saltan, y es la que
 * produce las facturas rechazadas. Dos casos la generan:
 *
 *   · el catálogo del SAT contra el que habría que comprobar no está cargado;
 *   · la comprobación solo la puede hacer el SAT (si el RFC EXISTE en el padrón
 *     y si el nombre coincide con la Constancia).
 *
 * Devolver `ok` en esos casos sería mentir con aplomo: el usuario leería «datos
 * fiscales correctos» y el PAC le diría que no. Es la regla 9 de AGENTS.md
 * —degradar en silencio— aplicada al dinero de alguien.
 *
 * ── LOS CÓDIGOS SON LOS DEL SAT ────────────────────────────────────────────
 *
 * Cuando existe un código oficial se usa ése y no uno inventado. Un mensaje que
 * dice «CFDI40158: el uso G01 no lo admite el régimen 605» se puede pegar en un
 * buscador y llegar a la documentación del SAT; uno que dice «uso inválido»
 * obliga a preguntar.
 */
import { createHash } from "node:crypto";
import {
  validarRfc,
  validarCurp,
  normalizarNombreFiscal,
  esRfcGenerico,
  RFC_PUBLICO_GENERAL,
  RFC_EXTRANJERO,
  type TipoPersona,
} from "./fiscal";

/** Un problema, atado a un campo, para que la API conteste por campo. */
export type Incidencia = {
  campo: string;
  /** Código del SAT cuando lo hay (`CFDI40158`), de la casa cuando no. */
  codigo: string;
  mensaje: string;
};

export type RolFiscal = "normal" | "publico_general" | "extranjero";

export type Expediente = {
  rolFiscal: RolFiscal;
  rfc: string;
  /** Como lo tecleó la persona; aquí se normaliza. */
  nombre: string;
  regimenFiscal: string;
  cpFiscal: string;
  paisResidencia?: string | null;
  numRegIdTrib?: string | null;
  curp?: string | null;
  usoCfdiDefault?: string | null;
  /** El expediente de la matriz, si esta ficha es una sucursal. */
  matriz?: { cpFiscal: string } | null;
};

/**
 * Lo que se sabe de los catálogos del SAT en este momento.
 *
 * Cada campo puede ser `null`, y `null` NO significa vacío: significa «ese
 * catálogo no está cargado». La diferencia decide si una comprobación produce
 * un error o una advertencia, y por eso no se modela con un `Set` vacío —un
 * conjunto vacío diría que ningún régimen existe, y haría fallar todo.
 */
export type CatalogosSat = {
  /** clave → a quién aplica. `null` si `c_RegimenFiscal` no está cargado. */
  regimenes: Map<string, { aplicaFisica: boolean; aplicaMoral: boolean }> | null;
  /** clave → a quién aplica. `null` si `c_UsoCFDI` no está cargado. */
  usos: Map<string, { aplicaFisica: boolean; aplicaMoral: boolean }> | null;
  /** Pares `uso|regimen` permitidos. `null` si la matriz no está cargada. */
  usoRegimen: Set<string> | null;
  /** ¿Existe este CP? `null` si `c_CodigoPostal` no está cargado. */
  cpExiste: ((cp: string) => boolean) | null;
};

/** Ningún catálogo cargado. El estado de una instalación recién migrada. */
export const SIN_CATALOGOS: CatalogosSat = {
  regimenes: null,
  usos: null,
  usoRegimen: null,
  cpExiste: null,
};

export type ResultadoExpediente = {
  ok: boolean;
  /** Impiden guardar. */
  errores: Incidencia[];
  /** No impiden guardar, pero impiden PROMETER que el timbrado saldrá. */
  advertencias: Incidencia[];
  /** El expediente ya normalizado, listo para persistir. */
  normalizado: {
    rfc: string;
    nombreFiscal: string;
    nombreCapturado: string;
    personaTipo: TipoPersona;
    cpFiscal: string;
    regimenFiscal: string;
    paisResidencia: string;
  } | null;
};

/** La llave de la matriz uso ↔ régimen. Un solo sitio la construye. */
const par = (uso: string, regimen: string) => `${uso}|${regimen}`;

/**
 * Valida el expediente fiscal completo.
 *
 * Puro: no toca la base. Los catálogos entran como parámetro, de modo que las
 * reglas se pueden probar sin Postgres y la misma función sirve para el alta
 * manual, la API y la importación masiva de CSV.
 */
export function validarExpediente(
  entrada: Expediente,
  catalogos: CatalogosSat = SIN_CATALOGOS,
): ResultadoExpediente {
  const errores: Incidencia[] = [];
  const advertencias: Incidencia[] = [];

  /* ── RFC, y de él el tipo de persona ─────────────────────────────────── */
  const rfc = validarRfc(entrada.rfc ?? "");
  if (!rfc.ok) {
    for (const e of rfc.errores) {
      errores.push({ campo: "rfc", codigo: e, mensaje: mensajeRfc(e) });
    }
  }

  /* ── El rol fiscal tiene que cuadrar con el RFC ───────────────────────── */
  const rol = entrada.rolFiscal ?? "normal";

  if (rol === "publico_general" && rfc.rfc !== RFC_PUBLICO_GENERAL) {
    errores.push({
      campo: "rfc",
      codigo: "rol_publico_general_rfc",
      mensaje: `El público en general se factura con ${RFC_PUBLICO_GENERAL}.`,
    });
  }
  if (rol === "extranjero" && rfc.rfc !== RFC_EXTRANJERO) {
    errores.push({
      campo: "rfc",
      codigo: "rol_extranjero_rfc",
      mensaje: `Un receptor extranjero se factura con ${RFC_EXTRANJERO}.`,
    });
  }
  if (rol === "normal" && esRfcGenerico(rfc.rfc)) {
    errores.push({
      campo: "rol_fiscal",
      codigo: "rol_normal_con_rfc_generico",
      mensaje:
        "Ese es un RFC genérico del SAT. Marca el cliente como público en general " +
        "o como extranjero, según corresponda.",
    });
  }

  /* ── Nombre fiscal ────────────────────────────────────────────────────── */
  const nombre = normalizarNombreFiscal(entrada.nombre ?? "");
  if (!nombre.normalizado) {
    errores.push({
      campo: "nombre_fiscal",
      codigo: "nombre_vacio",
      mensaje: "El nombre o razón social es obligatorio.",
    });
  } else if (rol === "publico_general" && nombre.normalizado !== "PUBLICO EN GENERAL") {
    errores.push({
      campo: "nombre_fiscal",
      codigo: "CFDI40147",
      mensaje: "El público en general se timbra literalmente como PUBLICO EN GENERAL.",
    });
  }

  /*
    El nombre solo lo puede confirmar el SAT, así que SIEMPRE queda advertido
    mientras no se haya validado contra el padrón. No es ruido: es el error de
    timbrado más frecuente que existe (CFDI40147) y lo que lo causa es
    exactamente creer que un nombre bien escrito es un nombre correcto.
  */
  if (rol === "normal" && nombre.normalizado) {
    advertencias.push({
      campo: "nombre_fiscal",
      codigo: "CFDI40147",
      mensaje:
        "El nombre solo se confirma contra la Constancia de Situación Fiscal. " +
        "Valida el cliente ante el SAT antes de facturarle.",
    });
  }

  /* ── CURP: solo persona física, y solo si se capturó ──────────────────── */
  if (entrada.curp) {
    if (rfc.tipo && rfc.tipo !== "fisica") {
      errores.push({
        campo: "curp",
        codigo: "curp_solo_fisica",
        mensaje: "La CURP es de una persona física; este RFC es de persona moral.",
      });
    } else {
      const curp = validarCurp(entrada.curp);
      if (!curp.ok) {
        errores.push({
          campo: "curp",
          codigo: curp.errores[0] ?? "curp_invalida",
          mensaje: "La CURP no es válida.",
        });
      }
    }
  }

  /* ── Código postal fiscal ─────────────────────────────────────────────── */
  const cp = (entrada.cpFiscal ?? "").trim();

  /*
    LA SUCURSAL HEREDA EL CP DE SU MATRIZ, SIN EXCEPCIÓN.

    El SAT no conoce sucursales: conoce RFC. Una sucursal es el mismo
    contribuyente, y su `DomicilioFiscalReceptor` es el de la Constancia, que es
    el de la matriz. El domicilio de la sucursal existe y es útil —para mandar a
    un técnico— pero va a `cliente_domicilio` y no toca el nodo fiscal.
  */
  const cpEfectivo = entrada.matriz ? entrada.matriz.cpFiscal : cp;
  if (entrada.matriz && cp && cp !== entrada.matriz.cpFiscal) {
    advertencias.push({
      campo: "cp_fiscal",
      codigo: "cp_heredado_de_matriz",
      mensaje:
        `Es una sucursal: se timbrará con el CP fiscal de la matriz (${entrada.matriz.cpFiscal}), ` +
        `no con ${cp}. El domicilio de la sucursal se guarda como domicilio de envío.`,
    });
  }

  if (!/^\d{5}$/.test(cpEfectivo)) {
    errores.push({
      campo: "cp_fiscal",
      codigo: "CFDI40148",
      mensaje: "El código postal fiscal son cinco dígitos.",
    });
  } else if (catalogos.cpExiste === null) {
    advertencias.push({
      campo: "cp_fiscal",
      codigo: "catalogo_no_cargado",
      mensaje:
        "No se pudo comprobar el código postal: el catálogo c_CodigoPostal del SAT no está cargado.",
    });
  } else if (!catalogos.cpExiste(cpEfectivo)) {
    errores.push({
      campo: "cp_fiscal",
      codigo: "CFDI40148",
      mensaje: `El código postal ${cpEfectivo} no existe en el catálogo del SAT.`,
    });
  }

  /* ── Régimen fiscal ───────────────────────────────────────────────────── */
  const regimen = (entrada.regimenFiscal ?? "").trim();
  if (!regimen) {
    errores.push({
      campo: "regimen_fiscal",
      codigo: "CFDI40149",
      mensaje: "El régimen fiscal es obligatorio desde CFDI 4.0.",
    });
  } else if (catalogos.regimenes === null) {
    advertencias.push({
      campo: "regimen_fiscal",
      codigo: "catalogo_no_cargado",
      mensaje: "No se pudo comprobar el régimen: el catálogo c_RegimenFiscal no está cargado.",
    });
  } else {
    const r = catalogos.regimenes.get(regimen);
    if (!r) {
      errores.push({
        campo: "regimen_fiscal",
        codigo: "CFDI40149",
        mensaje: `El régimen ${regimen} no existe en el catálogo del SAT.`,
      });
    } else if (rfc.tipo === "fisica" && !r.aplicaFisica) {
      errores.push({
        campo: "regimen_fiscal",
        codigo: "CFDI40149",
        mensaje: `El régimen ${regimen} no aplica a personas físicas, y este RFC lo es.`,
      });
    } else if (rfc.tipo === "moral" && !r.aplicaMoral) {
      errores.push({
        campo: "regimen_fiscal",
        codigo: "CFDI40149",
        mensaje: `El régimen ${regimen} no aplica a personas morales, y este RFC lo es.`,
      });
    }
  }

  /* ── Uso de CFDI contra régimen: el CFDI40158 ─────────────────────────── */
  const uso = (entrada.usoCfdiDefault ?? "").trim();
  if (uso && regimen) {
    if (catalogos.usoRegimen === null) {
      advertencias.push({
        campo: "uso_cfdi_default",
        codigo: "catalogo_no_cargado",
        mensaje:
          "No se pudo comprobar la compatibilidad uso/régimen: la matriz del SAT no está cargada.",
      });
    } else if (!catalogos.usoRegimen.has(par(uso, regimen))) {
      errores.push({
        campo: "uso_cfdi_default",
        codigo: "CFDI40158",
        mensaje: `El uso ${uso} no es compatible con el régimen ${regimen} del receptor.`,
      });
    }
  }

  /* ── Extranjeros ──────────────────────────────────────────────────────── */
  const pais = (entrada.paisResidencia ?? "MEX").trim().toUpperCase() || "MEX";

  if (rol === "extranjero") {
    if (pais === "MEX") {
      errores.push({
        campo: "pais_residencia",
        codigo: "extranjero_pais_mex",
        mensaje: "Un receptor extranjero necesita un país de residencia distinto de MEX.",
      });
    }
    if (!entrada.numRegIdTrib?.trim()) {
      errores.push({
        campo: "num_reg_id_trib",
        codigo: "extranjero_sin_num_reg_id_trib",
        mensaje:
          "Un receptor extranjero necesita su número de registro tributario del país de residencia.",
      });
    }
  } else if (pais !== "MEX") {
    errores.push({
      campo: "pais_residencia",
      codigo: "pais_incoherente",
      mensaje:
        "Un receptor con RFC mexicano reside en México. Si es extranjero, marca el rol fiscal.",
    });
  }

  const ok = errores.length === 0;

  return {
    ok,
    errores,
    advertencias,
    normalizado: ok
      ? {
          rfc: rfc.rfc,
          nombreFiscal: nombre.normalizado,
          nombreCapturado: nombre.capturado,
          // `rfc.tipo` no puede ser nulo aquí: sin tipo, `validarRfc` habría
          // fallado y no habría `ok`.
          personaTipo: rfc.tipo!,
          cpFiscal: cpEfectivo,
          regimenFiscal: regimen,
          paisResidencia: pais,
        }
      : null,
  };
}

function mensajeRfc(codigo: string): string {
  switch (codigo) {
    case "rfc_vacio":
      return "El RFC es obligatorio.";
    case "rfc_longitud":
      return "El RFC son 12 caracteres (persona moral) o 13 (persona física).";
    case "rfc_formato":
      return "El RFC no tiene la forma que exige el SAT.";
    case "rfc_fecha_invalida":
      return "Los seis dígitos centrales del RFC no son una fecha real.";
    case "rfc_digito_verificador":
      return "El último carácter del RFC no corresponde: revisa la captura.";
    case "rfc_palabra_inconveniente":
      return "Ese RFC no puede empezar así; el SAT sustituye la última letra por X.";
    default:
      return "El RFC no es válido.";
  }
}

/**
 * La huella de los cuatro datos que el SAT contrasta.
 *
 * Se guarda junto al veredicto de validación. Cuando alguien edita el nombre, el
 * RFC, el CP o el régimen, la huella deja de cuadrar y el veredicto se descarta
 * SOLO: un «válido» viejo sobre datos nuevos es peor que no haber validado
 * nunca, porque da confianza sin respaldo.
 *
 * Se normaliza antes de resumir para que un cambio cosmético —una minúscula, un
 * espacio de más— no invalide una validación que sigue siendo cierta.
 */
export function hashExpediente(datos: {
  rfc: string;
  nombreFiscal: string;
  cpFiscal: string;
  regimenFiscal: string;
}): string {
  const partes = [
    datos.rfc.trim().toUpperCase(),
    datos.nombreFiscal.trim().toUpperCase().replace(/\s+/g, " "),
    datos.cpFiscal.trim(),
    datos.regimenFiscal.trim(),
  ];
  return createHash("sha256").update(partes.join("|")).digest("hex");
}

/**
 * ¿Sigue valiendo el veredicto que hay guardado?
 *
 * Se pregunta al leer, no solo al escribir: una fila cuyo hash no cuadra está
 * mostrando un veredicto caduco, venga de donde venga el cambio —una edición,
 * una importación masiva, un `update` a mano en una consola—.
 */
export function validacionVigente(
  guardado: { hashDatos: string | null; resultado: string },
  actual: { rfc: string; nombreFiscal: string; cpFiscal: string; regimenFiscal: string },
): boolean {
  if (guardado.resultado === "no_validado") return false;
  if (!guardado.hashDatos) return false;
  return guardado.hashDatos === hashExpediente(actual);
}
