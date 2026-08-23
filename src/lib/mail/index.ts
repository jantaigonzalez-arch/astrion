import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";

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
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

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
