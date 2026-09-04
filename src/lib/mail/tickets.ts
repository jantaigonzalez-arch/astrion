import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { memberships, users } from "@/lib/db/platform";
import { getTenantContext } from "@/lib/tenancy/context";
import { tenantBase } from "@/lib/nav-server";
import { enviar } from "@/lib/mail";
import { crearAvisos, type TipoDeAviso } from "@/lib/notificaciones";

/**
 * Los avisos del sistema de tickets.
 *
 * ── QUÉ SE AVISA, Y A QUIÉN ────────────────────────────────────────────────
 *
 *   comentario   a la OTRA parte. Si escribe el agente, al cliente; si escribe
 *                el cliente, al agente asignado. Es el aviso que más vale: un
 *                ticket sin respuesta es la queja número uno de cualquier
 *                soporte, y casi siempre la respuesta estaba escrita y nadie
 *                se enteró.
 *   asignación   al agente que lo recibe. Nadie mira una cola ajena.
 *   estado       al cliente, y solo cuando se resuelve o se cierra. Los estados
 *                intermedios son del taller, no de quien espera.
 *   alta         DOS avisos, y son distintos: acuse a quien lo levantó con su
 *                folio, y aviso al equipo de que hay trabajo nuevo. El primero
 *                tranquiliza; el segundo es el que hace que alguien lo mire.
 *
 * ── LO QUE NO SE AVISA ─────────────────────────────────────────────────────
 *
 * Las notas internas. `addComment` las marca con `internal` y son justamente lo
 * que el equipo se dice entre sí: mandárselas al cliente sería la peor fuga
 * posible de este sistema, y por eso quien las filtra es quien llama, antes de
 * llegar aquí.
 *
 * Tampoco se avisa a quien provocó el cambio: recibir un correo contándote lo
 * que acabas de hacer enseña a ignorar los correos.
 *
 * ── NUNCA LANZAN ───────────────────────────────────────────────────────────
 *
 * Un aviso que falla no puede tumbar la acción que lo disparó. Se registra y se
 * sigue: el ticket vale más que el correo.
 */

type Persona = { email: string; name: string | null; esCliente: boolean };

/**
 * Quiénes son, y por qué canal les toca enterarse.
 *
 * `esCliente` decide el correo: el laboratorio no vive aquí dentro —entra
 * cuando tiene un problema y se va—, así que para él el correo sigue siendo el
 * canal. Al equipo se le avisa por la campana y se le deja de mandar correo,
 * que es lo que evita que los avisos se conviertan en ruido y acaben filtrados.
 *
 * El rol se lee de la membresía EN ESTA EMPRESA y no de la cuenta: la misma
 * persona puede ser cliente en un laboratorio y agente en otro, y el canal
 * depende de dónde está parada. Quien no tenga membresía —una cuenta dada de
 * baja que dejó comentarios— cuenta como cliente: es el lado que sí recibe
 * correo, y equivocarse hacia «le llega» es preferible a que no se entere.
 */
async function personas(
  ids: Array<string | null>,
  tenantId: string,
): Promise<Map<string, Persona>> {
  const limpios = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (limpios.length === 0) return new Map();
  const db = getDb();
  const filas = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(users)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId)),
    )
    .where(inArray(users.id, limpios));
  return new Map(
    filas.map((f) => [
      f.id,
      { email: f.email, name: f.name, esCliente: f.role !== "agent" && f.role !== "admin" && f.role !== "owner" && f.role !== "sales" },
    ]),
  );
}

/**
 * UN AVISO, DOS CANALES, UNA SOLA DECISIÓN.
 *
 * Escribe la campana para todos los destinatarios y manda el correo solo a los
 * que son cliente. Está aquí y no repartido por cada `avisar*` para que el
 * reparto de canales no pueda divergir entre un aviso y otro: era exactamente
 * así como el correo al equipo se coló en tres sitios distintos.
 *
 * Nunca lanza. Un aviso que falla no puede tumbar la acción que lo disparó.
 */
async function repartir(opts: {
  tenantId: string;
  ticketId: string;
  tipo: TipoDeAviso;
  destinatarios: Persona[];
  titulo: string;
  cuerpo: string[];
  boton: { texto: string; href: string };
  pie: string;
  asunto: string;
  /** Los ids, en el mismo orden que `destinatarios`. */
  ids: string[];
}): Promise<void> {
  await crearAvisos({
    paraUsuarios: opts.ids,
    ticketId: opts.ticketId,
    tipo: opts.tipo,
    titulo: opts.titulo,
    cuerpo: opts.cuerpo[0] ?? null,
  });

  const porCorreo = opts.destinatarios.filter((p) => p.esCliente).map((p) => p.email);
  if (porCorreo.length === 0) return;

  const { html, texto } = plantilla({
    titulo: opts.titulo,
    cuerpo: opts.cuerpo,
    boton: opts.boton,
    pie: opts.pie,
  });
  await enviar(opts.tenantId, { para: porCorreo, asunto: opts.asunto, html, texto });
}

/** La dirección pública del ticket, en el dominio de SU empresa. */
async function enlace(slug: string, ticketId: string): Promise<string> {
  const base = await tenantBase(slug, "es");
  return `${base}/tickets/${ticketId}`;
}

function plantilla(opts: {
  titulo: string;
  cuerpo: string[];
  boton: { texto: string; href: string };
  pie: string;
}): { html: string; texto: string } {
  const { titulo, cuerpo, boton, pie } = opts;
  // Sin CSS externo ni imágenes: los clientes de correo bloquean lo primero y
  // esconden lo segundo hasta que alguien pulsa «mostrar contenido». Todo va en
  // línea y el mensaje se entiende aunque no se cargue nada.
  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111;max-width:560px">
  <h2 style="margin:0 0 16px;font-size:18px;font-weight:600">${escapar(titulo)}</h2>
  ${cuerpo.map((p) => `<p style="margin:0 0 12px">${escapar(p)}</p>`).join("\n  ")}
  <p style="margin:24px 0">
    <a href="${escapar(boton.href)}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500">${escapar(boton.texto)}</a>
  </p>
  <p style="margin:0;font-size:12px;color:#666">${escapar(pie)}</p>
</div>`.trim();

  const texto = [titulo, "", ...cuerpo, "", `${boton.texto}: ${boton.href}`, "", pie].join("\n");
  return { html, texto };
}

/** El contenido viene de la base y de lo que escribe la gente: se escapa. */
function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Ticket = {
  id: string;
  reference: string;
  subject: string;
  createdById: string;
  assignedToId: string | null;
};
/**
 * Alguien comentó: se avisa a la otra parte.
 *
 * `autorId` no recibe nada, y `interna` corta el aviso antes de mirar a nadie —
 * las dos comprobaciones son de seguridad, no de cortesía.
 */
export async function avisarComentario(
  t: Ticket,
  autorId: string,
  cuerpo: string,
  interna: boolean,
): Promise<void> {
  if (interna) return;
  try {
    const ctx = await getTenantContext();
    if (!ctx) return;

    // El destinatario es «el otro»: si comenta el cliente, el agente asignado;
    // si comenta el equipo, quien lo levantó.
    const destinoId = autorId === t.createdById ? t.assignedToId : t.createdById;
    if (!destinoId || destinoId === autorId) return;

    const gente = await personas([destinoId, autorId], ctx.tenantId);
    const destino = gente.get(destinoId);
    if (!destino) return;
    const autor = gente.get(autorId);

    const href = await enlace(ctx.slug, t.id);
    await repartir({
      tenantId: ctx.tenantId,
      ticketId: t.id,
      tipo: "ticket.comentado",
      destinatarios: [destino],
      ids: [destinoId],
      titulo: `${t.reference} · nueva respuesta`,
      cuerpo: [
        `${autor?.name ?? "Alguien"} escribió en el ticket «${t.subject}».`,
        // Un extracto y no el mensaje entero: el correo avisa, la conversación
        // vive en el sistema. Mandarla completa invita a responder por correo,
        // que es donde el hilo se pierde.
        cuerpo.length > 300 ? `${cuerpo.slice(0, 300)}…` : cuerpo,
      ],
      boton: { texto: "Ver el ticket", href },
      pie: `${ctx.name} · recibes esto porque participas en ${t.reference}.`,
      asunto: `${t.reference} · nueva respuesta`,
    });
  } catch (e) {
    console.error("[mail] aviso de comentario", e);
  }
}

/** Se asignó a alguien: se le avisa. Nadie mira una cola que no es suya. */
export async function avisarAsignacion(t: Ticket, actorId: string): Promise<void> {
  try {
    if (!t.assignedToId || t.assignedToId === actorId) return;
    const ctx = await getTenantContext();
    if (!ctx) return;

    const gente = await personas([t.assignedToId], ctx.tenantId);
    const destino = gente.get(t.assignedToId);
    if (!destino) return;

    const href = await enlace(ctx.slug, t.id);
    await repartir({
      tenantId: ctx.tenantId,
      ticketId: t.id,
      tipo: "ticket.asignado",
      destinatarios: [destino],
      ids: [t.assignedToId],
      titulo: `${t.reference} · te lo asignaron`,
      cuerpo: [`Te asignaron el ticket «${t.subject}».`],
      boton: { texto: "Abrir el ticket", href },
      pie: `${ctx.name} · recibes esto porque eres el responsable de ${t.reference}.`,
      asunto: `${t.reference} · te lo asignaron`,
    });
  } catch (e) {
    console.error("[mail] aviso de asignación", e);
  }
}

/**
 * Cambió el estado: se avisa al cliente, y solo si terminó.
 *
 * Los estados intermedios —en progreso, esperando— son del taller. Avisarlos
 * convierte el correo en ruido y el ruido en filtro, y entonces tampoco se lee
 * el que sí importaba.
 */
export async function avisarEstado(
  t: Ticket,
  nuevo: string,
  actorId: string,
): Promise<void> {
  try {
    if (nuevo !== "resolved" && nuevo !== "closed") return;
    if (t.createdById === actorId) return;
    const ctx = await getTenantContext();
    if (!ctx) return;

    const gente = await personas([t.createdById], ctx.tenantId);
    const destino = gente.get(t.createdById);
    if (!destino) return;

    const verbo = nuevo === "resolved" ? "resuelto" : "cerrado";
    const href = await enlace(ctx.slug, t.id);
    await repartir({
      tenantId: ctx.tenantId,
      ticketId: t.id,
      tipo: "ticket.resuelto",
      destinatarios: [destino],
      ids: [t.createdById],
      titulo: `${t.reference} · ${verbo}`,
      cuerpo: [
        `Tu ticket «${t.subject}» quedó ${verbo}.`,
        nuevo === "resolved"
          ? "Si el problema sigue, respóndenos desde el ticket y lo retomamos."
          : "Si necesitas algo más, levanta uno nuevo.",
      ],
      boton: { texto: "Ver el ticket", href },
      pie: `${ctx.name} · recibes esto porque levantaste ${t.reference}.`,
      asunto: `${t.reference} · ${verbo}`,
    });
  } catch (e) {
    console.error("[mail] aviso de estado", e);
  }
}

/** Acuse de recibo al levantar un ticket: su folio, por escrito. */
export async function avisarAlta(t: Ticket): Promise<void> {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return;

    const gente = await personas([t.createdById], ctx.tenantId);
    const destino = gente.get(t.createdById);
    if (!destino) return;

    const href = await enlace(ctx.slug, t.id);
    await repartir({
      tenantId: ctx.tenantId,
      ticketId: t.id,
      tipo: "ticket.creado",
      destinatarios: [destino],
      ids: [t.createdById],
      titulo: `${t.reference} · recibimos tu solicitud`,
      cuerpo: [
        `Registramos «${t.subject}» con el folio ${t.reference}.`,
        "Te avisaremos por aquí cuando haya novedades.",
      ],
      boton: { texto: "Seguir el ticket", href },
      pie: `${ctx.name} · guarda el folio ${t.reference} para cualquier consulta.`,
      asunto: `${t.reference} · recibimos tu solicitud`,
    });
  } catch (e) {
    console.error("[mail] aviso de alta", e);
  }
}

/**
 * Quién atiende en esta empresa, para avisarle de lo que entra.
 *
 * Agentes, administradores y el dueño: los mismos que `getAgents()` ofrece para
 * asignar un ticket. Se leen de la membresía ACTIVA, no de una lista escrita a
 * mano, para que dar de baja a alguien también lo saque de los avisos — si no,
 * el primer correo que rebota es el de una persona que ya no trabaja ahí.
 *
 * Los permisos por módulo no entran aquí a propósito. Un aviso no es una puerta:
 * quien tenga Servicio en «Sin acceso» verá un renglón que no puede abrir, y eso
 * es un aviso de más, no una fuga. Filtrarlo exigiría resolver el permiso
 * efectivo de cada miembro —una consulta por persona— para ahorrar un renglón.
 */
async function equipoQueAtiende(
  tenantId: string,
): Promise<Array<Persona & { id: string }>> {
  const db = getDb();
  const filas = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.active, true),
        eq(users.active, true),
        inArray(memberships.role, ["agent", "admin", "owner"]),
      ),
    );
  // Son del equipo por definición de la consulta: campana sí, correo no.
  return filas.map((f) => ({ ...f, esCliente: false }));
}

/**
 * Entró trabajo nuevo: se le avisa a quien atiende.
 *
 * ── ES EL AVISO QUE FALTABA ───────────────────────────────────────────────
 *
 * `avisarAlta` da el acuse a quien levantó el ticket, y estaba escrito pero sin
 * llamar. Aun conectándolo faltaba la otra mitad, que es la que de verdad hace
 * que un ticket se atienda: nadie del equipo se enteraba de que había entrado
 * uno. La única forma de saberlo era entrar a mirar la cola.
 *
 * ── A TODO EL EQUIPO, Y NO AL ASIGNADO ────────────────────────────────────
 *
 * Porque al levantarse no hay asignado: asignar es el paso siguiente, y tiene su
 * propio aviso. Mandarlo a todos es lo correcto mientras la cola sea de todos;
 * el día que haya reparto por especialidad, este es el sitio donde se acota.
 *
 * ── Y LES LLEGA POR CAMPANA, NO POR CORREO ────────────────────────────────
 *
 * Lo decide `repartir` a partir de `esCliente`, que aquí es falso para todos.
 * Es el aviso más frecuente de los cinco —uno por cada ticket que entra— y por
 * tanto el que antes habría enseñado al equipo a filtrar el correo.
 */
export async function avisarEquipoDeAlta(
  t: Ticket,
  actorId: string,
): Promise<void> {
  try {
    const ctx = await getTenantContext();
    if (!ctx) return;

    const equipo = await equipoQueAtiende(ctx.tenantId);
    // Nunca a quien lo acaba de levantar: enterarte de lo que acabas de hacer
    // enseña a ignorar los avisos. Misma regla que los otros cuatro.
    const destinatarios = equipo.filter((p) => p.id !== actorId);
    if (destinatarios.length === 0) return;

    const gente = await personas([actorId], ctx.tenantId);
    const quien = gente.get(actorId)?.name ?? null;
    const href = await enlace(ctx.slug, t.id);
    await repartir({
      tenantId: ctx.tenantId,
      ticketId: t.id,
      tipo: "ticket.creado",
      destinatarios,
      ids: destinatarios.map((p) => p.id),
      titulo: `${t.reference} · entró un ticket nuevo`,
      cuerpo: [
        `${quien ? `${quien} levantó` : "Entró"} «${t.subject}».`,
        "Todavía no tiene a nadie asignado.",
      ],
      boton: { texto: "Abrir el ticket", href },
      pie: `${ctx.name} · recibes esto porque atiendes la cola de servicio.`,
      asunto: `${t.reference} · ticket nuevo`,
    });
  } catch (e) {
    console.error("[mail] aviso de alta al equipo", e);
  }
}

/** Reexportado para que las acciones tipen el ticket que pasan. */
export type { Ticket as TicketParaAviso };

/**
 * Expuesto solo para ejercitar las plantillas y la lista de destinatarios desde
 * un script de prueba. `equipoQueAtiende` decide a quién le llega el aviso de un
 * ticket nuevo y `personas` decide POR QUÉ CANAL le llega a cada quien: las dos
 * cosas hay que poder comprobarlas contra la base real sin montar una petición.
 */
export const _interno = { plantilla, equipoQueAtiende, personas };
