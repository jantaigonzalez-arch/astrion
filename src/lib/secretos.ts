import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Guardar secretos de TERCEROS: hoy, la contraseña de correo de cada empresa.
 *
 * ── POR QUÉ NO ES UN HASH ──────────────────────────────────────────────────
 *
 * Una contraseña de usuario se compara, así que basta con hashearla y nadie
 * necesita recuperarla nunca. Ésta hay que ENTREGÁRSELA al servidor SMTP en
 * cada envío, así que hay que poder devolverla. Eso la convierte en un secreto
 * reversible, y los secretos reversibles se cifran.
 *
 * ── LO QUE HAY QUE TENER PRESENTE ──────────────────────────────────────────
 *
 * Esa contraseña abre el buzón entero de un cliente: leer su correo, escribir
 * en su nombre. Es el dato más peligroso de esta base de datos, más que
 * cualquier ticket o contrato, y por eso:
 *
 *   · Se cifra con una clave que NO está en la base. Si alguien se lleva un
 *     volcado de Postgres, se lleva ruido.
 *   · No se devuelve nunca a la interfaz. Se guarda, se usa en el servidor y
 *     la pantalla solo enseña si hay algo puesto o no.
 *   · No se registra en ningún log, ni siquiera al fallar un envío.
 *
 * ── AES-256-GCM, NO CBC ────────────────────────────────────────────────────
 *
 * GCM además de cifrar AUTENTICA: si alguien con acceso a la base cambia un
 * byte del texto cifrado, el descifrado falla en vez de devolver basura que
 * acabaría enviándose como contraseña a un servidor ajeno.
 *
 * ── DE DÓNDE SALE LA CLAVE ─────────────────────────────────────────────────
 *
 * De `MAIL_SECRET` si existe, y si no de `AUTH_SECRET`, que ya es obligatorio
 * para que la aplicación arranque. Se derivan con scrypt en vez de usarse en
 * crudo: las dos son cadenas escritas por una persona, no 32 bytes aleatorios.
 *
 * Cambiar el secreto INUTILIZA lo ya cifrado. No es un fallo —es lo que hace
 * que el volcado robado no sirva— pero significa que rotarlo obliga a que cada
 * empresa vuelva a escribir su contraseña. Queda dicho aquí porque el día que
 * alguien rote `AUTH_SECRET` sin saberlo, el síntoma será «el correo dejó de
 * salir» sin ninguna pista.
 */

const VERSION = "v1";

function clave(): Buffer {
  const material = process.env.MAIL_SECRET ?? process.env.AUTH_SECRET;
  if (!material) {
    throw new Error(
      "Falta MAIL_SECRET (o AUTH_SECRET) para cifrar las contraseñas de correo.",
    );
  }
  // Sal fija y no aleatoria: la clave tiene que ser la misma en cada arranque y
  // en cada instancia, o lo cifrado ayer no se abre hoy. Lo que aporta la
  // aleatoriedad por mensaje es el IV, que sí es distinto cada vez.
  return scryptSync(material, "astraion.correo.v1", 32);
}

/** Cifra un secreto. Devuelve una cadena guardable en una columna de texto. */
export function sellar(claro: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const cifrado = Buffer.concat([c.update(claro, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(".");
}

/**
 * Abre un secreto sellado. Devuelve null si no se puede.
 *
 * Null y no una excepción porque quien llama es un envío de correo: si la
 * contraseña no se puede descifrar —secreto rotado, fila manipulada— lo
 * correcto es no mandar el correo y decirlo, no tumbar la acción que lo pidió.
 */
export function abrir(sellado: string | null | undefined): string | null {
  if (!sellado) return null;
  const partes = sellado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) return null;
  try {
    const [, iv, tag, cifrado] = partes;
    const d = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(cifrado, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
