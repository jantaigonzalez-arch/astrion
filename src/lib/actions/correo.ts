"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants } from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import { requireTenant, puedeEn } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { sellar, abrir } from "@/lib/secretos";
import { enviar, probarSmtp } from "@/lib/mail";

/**
 * La empresa configura su propio buzón de salida.
 *
 * Solo administración: decidir desde qué cuenta sale el correo de la empresa —y
 * escribir la contraseña de esa cuenta— no es un ajuste de comodidad.
 *
 * ── LA CONTRASEÑA ENTRA Y NO SALE ──────────────────────────────────────────
 *
 * Se cifra al guardarla y no se devuelve JAMÁS a la interfaz: la pantalla solo
 * sabe si hay una puesta. Quien quiera cambiarla escribe una nueva; quien no
 * la toque deja el campo vacío y se conserva la que había. Eso es lo que
 * permite editar el puerto sin volver a teclear la contraseña, que si no es la
 * receta segura para que alguien la escriba mal y deje el correo caído.
 */

export type CorreoState = { ok: boolean; error?: string; message?: string };

async function soloAdmin(): Promise<string | null> {
  return (await puedeEn("configuracion", "administrar"))
    ? null
    : "Solo un administrador configura el correo de la empresa.";
}

/** Guarda la configuración y la COMPRUEBA antes de darla por buena. */
export async function guardarCorreoAction(
  _prev: CorreoState,
  form: FormData,
): Promise<CorreoState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const ctx = await requireTenant();
  const db = getDb();

  const host = String(form.get("host") ?? "").trim();
  const puerto = Number(form.get("port") ?? 587);
  const usuario = String(form.get("user") ?? "").trim();
  const nueva = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "").trim() || usuario;
  const fromName = String(form.get("fromName") ?? "").trim() || null;
  const replyTo = String(form.get("replyTo") ?? "").trim() || null;

  // Vaciar el servidor es apagar el buzón propio: se limpia todo, contraseña
  // incluida, y los avisos vuelven al remitente de la plataforma.
  if (!host) {
    await db
      .update(tenants)
      .set({
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpCheckedAt: null,
      })
      .where(eq(tenants.id, ctx.tenantId));
    revalidateTenant();
    return { ok: true, message: "Buzón propio desconectado. Los avisos vuelven a salir por Astraion." };
  }

  if (!usuario) return { ok: false, error: "Falta la cuenta de correo." };
  if (!Number.isFinite(puerto) || puerto < 1 || puerto > 65535) {
    return { ok: false, error: "El puerto no es válido. Suele ser 587, o 465 si tu proveedor pide SSL." };
  }

  // Sin contraseña nueva se reusa la guardada: así se puede corregir el puerto
  // sin volver a teclearla.
  const [actual] = await db
    .select({ pass: tenants.smtpPassword })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

  const clave = nueva || abrir(actual?.pass);
  if (!clave) {
    return { ok: false, error: "Falta la contraseña de la cuenta." };
  }

  // Se comprueba ANTES de guardar. Guardar algo que no funciona y enterarse dos
  // días después, cuando un cliente pregunte por qué no le llegó nada, es el
  // fallo que esta pantalla existe para evitar.
  const prueba = await probarSmtp({ host, port: puerto, user: usuario, pass: clave });
  if (!prueba.ok) {
    return {
      ok: false,
      error: `El servidor rechazó la conexión: ${prueba.motivo}`,
    };
  }

  await db
    .update(tenants)
    .set({
      smtpHost: host,
      smtpPort: puerto,
      smtpUser: usuario,
      smtpPassword: sellar(clave),
      smtpCheckedAt: new Date(),
      mailFrom: from,
      mailFromName: fromName,
      mailReplyTo: replyTo,
    })
    .where(eq(tenants.id, ctx.tenantId));

  revalidateTenant();
  return { ok: true, message: "Conectado. Los avisos ya salen desde tu buzón." };
}

/**
 * Manda un correo de prueba a quien lo pide.
 *
 * A la dirección de la SESIÓN y no a una que se escriba: una pantalla que manda
 * correo a donde le digan es un relay abierto con formulario bonito.
 */
/* eslint-disable @typescript-eslint/no-unused-vars --
   La firma la impone `useActionState`: recibe el estado previo y el formulario
   aunque esta acción no necesite ninguno de los dos. Quitarlos rompería el
   tipo; renombrarlos escondería que se ignoran a propósito. */
export async function probarCorreoAction(
  _prev: CorreoState,
  _form: FormData,
): Promise<CorreoState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const session = await auth();
  const destino = session?.user?.email;
  if (!destino) return { ok: false, error: "Tu cuenta no tiene correo." };

  const ctx = await requireTenant();
  const r = await enviar(ctx.tenantId, {
    para: destino,
    asunto: `Prueba de correo · ${ctx.name}`,
    html: "<p>Si estás leyendo esto, los avisos de tickets van a llegar bien.</p>",
    texto: "Si estás leyendo esto, los avisos de tickets van a llegar bien.",
  });

  if (!r.ok) return { ok: false, error: r.motivo };

  /*
    EL TRANSPORTE DE CONSOLA NO ES UN ENVÍO, y decirlo aquí es el punto.

    `enviar()` devuelve `ok: true` también cuando el transporte es la consola —
    imprime el correo al log del contenedor y no sale nada de la máquina—. Este
    botón respondía «Enviado a tu correo. Revisa que haya llegado», y con eso se
    comprobó en producción que los avisos funcionaban cuando no salía ni uno.

    Es el peor resultado posible de un botón de prueba: certifica lo contrario
    de lo que pasa, y quien lo pulsa deja de buscar el problema.
  */
  if (r.transporte === "consola") {
    return {
      ok: false,
      error:
        "NO se envió nada. Este despliegue no tiene ningún buzón ni proveedor " +
        "de correo configurado, así que los avisos se escriben en el registro " +
        "del servidor y se quedan ahí. Configura el buzón de arriba y vuelve a " +
        "probar.",
    };
  }

  return {
    ok: true,
    message: r.propio
      ? `Enviado a ${destino} desde tu buzón. Revisa que haya llegado.`
      : `Enviado a ${destino}, pero desde el remitente de Astraion: todavía no tienes buzón propio configurado.`,
  };
}
