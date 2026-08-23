import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";
import { abrir } from "@/lib/secretos";

/**
 * Enviar correo, y desde el dominio de CADA empresa.
 *
 * ── LAS DOS COSAS QUE HACEN FALTA, Y NINGUNA ES ESTE ARCHIVO ───────────────
 *
 * Un dominio cuyo DNS controle quien envía, y un servicio de envío. Mandar SMTP
 * desde el propio servidor cae en spam casi siempre: desde 2024 Gmail y Outlook
 * exigen SPF, DKIM y DMARC alineados para aceptar correo de remitentes con
 * volumen. Esto es solo la costura entre la aplicación y ese servicio.
 *
 * ── POR QUÉ HAY UN TRANSPORTE DE CONSOLA ───────────────────────────────────
 *
 * Para que el sistema de avisos se pueda escribir y probar entero sin contratar
 * nada ni tocar el DNS de nadie. Es el transporte por omisión: sin
 * `MAIL_PROVIDER=resend` no sale un solo correo de esta máquina, que es
 * exactamente lo que se quiere en desarrollo — un aviso de ticket de prueba
 * mandado de verdad al buzón de un cliente real es un incidente, no un fallo.
 *
 * ── EL REMITENTE SE DECIDE POR EMPRESA, Y SE DEGRADA ──────────────────────
 *
 * Cada inquilino publica su dominio y avisa desde él. Mientras no esté
 * VERIFICADO, el aviso sale por el remitente de la plataforma en vez de no
 * salir: que el cliente no se haya peleado todavía con su DNS no puede
 * significar que su equipo deje de enterarse de los tickets.
 *
 * Y nunca se envía desde un dominio sin verificar. No es «casi funciona»: es
 * correo que acaba en spam y que quema la reputación de todo lo demás.
 */

export type Correo = {
  para: string | string[];
  asunto: string;
  html: string;
  /** Alternativa en texto plano. Sin ella, muchos filtros puntúan peor. */
  texto: string;
};

export type Remitente = {
  from: string;
  fromName: string;
  replyTo?: string;
  /** Falso = se está usando el remitente de la plataforma como respaldo. */
  propio: boolean;
  /** El buzón de la empresa, si lo configuró. Manda sobre todo lo demás. */
  smtp?: { host: string; port: number; user: string; pass: string };
};

/** El remitente de la plataforma: el respaldo cuando la empresa no tiene el suyo. */
function remitenteDePlataforma(): Remitente {
  return {
    from: process.env.MAIL_FROM ?? "avisos@localhost",
    fromName: process.env.MAIL_FROM_NAME ?? "Astraion",
    propio: false,
  };
}

/**
 * Desde qué dirección avisa esta empresa.
 *
 * Se exige `mailVerifiedAt` Y `mailFrom`: tener el dominio dado de alta no basta
 * —el cliente pudo no publicar los registros nunca— y la fecha es la única
 * prueba de que el proveedor los vio.
 */
export async function remitenteDe(tenantId: string): Promise<Remitente> {
  const db = getDb();
  const [t] = await db
    .select({
      from: tenants.mailFrom,
      fromName: tenants.mailFromName,
      replyTo: tenants.mailReplyTo,
      verificado: tenants.mailVerifiedAt,
      name: tenants.name,
      brandName: tenants.brandName,
      smtpHost: tenants.smtpHost,
      smtpPort: tenants.smtpPort,
      smtpUser: tenants.smtpUser,
      smtpPassword: tenants.smtpPassword,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  /*
    El buzón propio manda sobre todo lo demás.

    Si la empresa configuró su SMTP, ése es el remitente que eligió a mano y
    además el único que no depende de nada nuestro: sale de su servidor, con su
    firma. El dominio verificado y el respaldo de plataforma son los caminos
    para quien NO lo configuró.

    Si la contraseña no se puede descifrar —secreto rotado, fila manipulada— se
    cae al siguiente camino en vez de intentar un envío que va a fallar. Ver
    `lib/secretos`.
  */
  if (t?.smtpHost && t.smtpUser && t.smtpPassword) {
    const pass = abrir(t.smtpPassword);
    if (pass) {
      return {
        from: t.from ?? t.smtpUser,
        fromName: t.fromName ?? t.brandName ?? t.name,
        replyTo: t.replyTo ?? undefined,
        propio: true,
        smtp: {
          host: t.smtpHost,
          port: t.smtpPort ?? 587,
          user: t.smtpUser,
          pass,
        },
      };
    }
    console.error("[mail] no se pudo descifrar la contraseña SMTP del inquilino");
  }

  if (!t?.from || !t.verificado) {
    const base = remitenteDePlataforma();
    // Aunque el sobre lo firme la plataforma, el NOMBRE es el de la empresa: a
    // quien recibe le importa de quién es el ticket, no qué infraestructura lo
    // mandó. Y el Responder-a sigue siendo el de la empresa si lo puso.
    return {
      ...base,
      fromName: t?.brandName ?? t?.name ?? base.fromName,
      replyTo: t?.replyTo ?? undefined,
    };
  }

  return {
    from: t.from,
    fromName: t.fromName ?? t.brandName ?? t.name,
    replyTo: t.replyTo ?? undefined,
    propio: true,
  };
}

export type Resultado =
  | { ok: true; id: string; propio: boolean }
  | { ok: false; motivo: string };

/**
 * Manda un correo. NUNCA lanza.
 *
 * Un aviso que falla no puede tumbar la acción que lo disparó: si el proveedor
 * está caído, el ticket se crea igual y lo que se pierde es el aviso. Al revés
 * —perder el ticket porque no se pudo avisar— sería cambiar un problema
 * pequeño por uno grave.
 */
export async function enviar(
  tenantId: string,
  correo: Correo,
): Promise<Resultado> {
  const r = await remitenteDe(tenantId);
  const proveedor = process.env.MAIL_PROVIDER ?? "consola";

  try {
    // El buzón de la empresa gana incluso al proveedor global: si lo configuró,
    // es porque quiere que salga de ahí.
    if (r.smtp) return await porSmtp(r, correo);
    if (proveedor === "resend") return await porResend(r, correo);
    return porConsola(r, correo);
  } catch (e) {
    console.error("[mail] no se pudo enviar", e);
    return { ok: false, motivo: e instanceof Error ? e.message : "desconocido" };
  }
}

/** Desarrollo: se imprime lo que se habría mandado y no sale nada de la máquina. */
function porConsola(r: Remitente, c: Correo): Resultado {
  const para = Array.isArray(c.para) ? c.para.join(", ") : c.para;
  console.log(
    [
      "",
      "── CORREO (transporte de consola: no se envió nada) ──────────────",
      `  De       : ${r.fromName} <${r.from}>${r.propio ? "" : "  ← remitente de plataforma"}`,
      r.replyTo ? `  Responder: ${r.replyTo}` : null,
      `  Para     : ${para}`,
      `  Asunto   : ${c.asunto}`,
      "",
      c.texto.replace(/^/gm, "  "),
      "──────────────────────────────────────────────────────────────────",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return { ok: true, id: "consola", propio: r.propio };
}

/**
 * Resend. Se llama por HTTP y no con su SDK a propósito: es una petición y
 * añadir una dependencia para formar un JSON de cuatro campos ata el proyecto a
 * la vida de ese paquete. Cambiar a SES o Postmark es reescribir esta función.
 */
async function porResend(r: Remitente, c: Correo): Promise<Resultado> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return { ok: false, motivo: "falta RESEND_API_KEY" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${r.fromName} <${r.from}>`,
      to: Array.isArray(c.para) ? c.para : [c.para],
      subject: c.asunto,
      html: c.html,
      text: c.texto,
      ...(r.replyTo ? { reply_to: r.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    return { ok: false, motivo: `resend ${res.status}: ${await res.text()}` };
  }
  const datos = (await res.json()) as { id?: string };
  return { ok: true, id: datos.id ?? "?", propio: r.propio };
}

/**
 * El buzón de la propia empresa.
 *
 * `secure` se deduce del puerto y no se pregunta: 465 es TLS desde el primer
 * byte y 587 empieza en claro y sube con STARTTLS. Es la confusión número uno
 * de cualquier configuración de correo, y no hay motivo para trasladársela a
 * quien solo quiere que le lleguen los avisos.
 *
 * El error se devuelve tal cual lo da el servidor: «535 authentication failed»
 * le dice a un administrador exactamente qué pasa, y traducirlo a «no se pudo
 * enviar» sería quitarle la única pista útil. La CONTRASEÑA no aparece nunca
 * en ese mensaje — nodemailer no la incluye, y aquí no se añade.
 */
async function porSmtp(r: Remitente, c: Correo): Promise<Resultado> {
  const { createTransport } = await import("nodemailer");
  const t = createTransport({
    host: r.smtp!.host,
    port: r.smtp!.port,
    secure: r.smtp!.port === 465,
    auth: { user: r.smtp!.user, pass: r.smtp!.pass },
  });

  const info = await t.sendMail({
    from: `${r.fromName} <${r.from}>`,
    to: Array.isArray(c.para) ? c.para.join(", ") : c.para,
    subject: c.asunto,
    html: c.html,
    text: c.texto,
    ...(r.replyTo ? { replyTo: r.replyTo } : {}),
  });

  return { ok: true, id: info.messageId, propio: true };
}

/**
 * Comprueba unas credenciales SMTP sin mandar nada.
 *
 * Existe para que la pantalla de configuración pueda decir «funciona» o «no
 * funciona» en el momento en que se guarda, y no dos días después cuando un
 * cliente pregunte por qué no le llegó nada. `verify()` abre la conexión y
 * autentica; no manda correo.
 */
export async function probarSmtp(cfg: {
  host: string;
  port: number;
  user: string;
  pass: string;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  try {
    const { createTransport } = await import("nodemailer");
    await createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    }).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "desconocido" };
  }
}
