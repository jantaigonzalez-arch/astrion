import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/tenancy/context";
import { notifications, tickets } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/**
 * La bandeja de avisos: lo que a cada persona le falta ver.
 *
 * ── EL REPARTO DE CANALES, DICHO EN UN SITIO ──────────────────────────────
 *
 * Campana para todo el mundo; correo SOLO para el cliente. Quien trabaja aquí
 * dentro se entera en la pantalla que ya tiene abierta, y el laboratorio —que
 * entra cuando tiene un problema y se va— sigue recibiendo su correo porque
 * para él ese es el canal.
 *
 * Mandarle correo también al equipo era lo que había, y es lo que acaba
 * convirtiendo los avisos en ruido: un agente que recibe un mensaje por cada
 * ticket, cada comentario y cada asignación los filtra en una semana, y a
 * partir de ahí tampoco lee el que sí importaba. Quién recibe qué se decide en
 * `mail/tickets.ts`, que es donde se sabe si el destinatario es del equipo o
 * es el cliente.
 *
 * ── NUNCA LANZAN ──────────────────────────────────────────────────────────
 *
 * Mismo criterio que los avisos por correo: un aviso que falla no puede tumbar
 * la acción que lo disparó. Si esto revienta, el ticket ya está creado y lo
 * que se pierde es el renglón de la campana.
 */

/** Los cinco sucesos que hoy alimentan la bandeja. Cerrado a propósito. */
export const TIPOS_DE_AVISO = [
  "ticket.creado",
  "ticket.comentado",
  "ticket.asignado",
  "ticket.resuelto",
] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

export type AvisoNuevo = {
  /** A quiénes. Una fila por cada uno: `read_at` es de cada persona. */
  paraUsuarios: string[];
  ticketId: string;
  tipo: TipoDeAviso;
  /** Ya redactado y con el folio dentro. Ver la nota de la tabla. */
  titulo: string;
  cuerpo?: string | null;
};

/**
 * Escribe el aviso para cada destinatario.
 *
 * Acepta `conexion` para poder escribirse DENTRO de la transacción que crea el
 * ticket cuando quien llama la tiene a mano. Hoy se llama después de confirmar
 * —igual que los correos—, porque un aviso perdido es mejor que un ticket
 * perdido; el parámetro está para que un futuro cambio de criterio no obligue a
 * reescribir la firma.
 */
export async function crearAvisos(
  aviso: AvisoNuevo,
  conexion?: DbOrTx,
): Promise<void> {
  try {
    // Sin destinatarios no hay nada que escribir, y `values([])` es un error
    // de sintaxis en Postgres: la lista vacía es el caso normal —un ticket que
    // levanta el único agente que hay— y no una excepción.
    const gente = [...new Set(aviso.paraUsuarios.filter(Boolean))];
    if (gente.length === 0) return;

    const db = conexion ?? (await tenantDb());
    await db.insert(notifications).values(
      gente.map((userId) => ({
        userId,
        ticketId: aviso.ticketId,
        kind: aviso.tipo,
        title: aviso.titulo,
        body: aviso.cuerpo ?? null,
      })),
    );
  } catch (e) {
    console.error("[avisos] no se pudieron escribir", e);
  }
}

export type AvisoEnPantalla = {
  id: string;
  ticketId: string;
  reference: string | null;
  kind: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Mis avisos, los más recientes primero.
 *
 * Trae leídos y sin leer en la misma lista: una campana que solo enseña lo
 * pendiente obliga a recordar lo que ya se vio, y el gesto natural al abrirla
 * es «qué me perdí», no «qué me falta por marcar».
 *
 * El folio sale de un join y no de una columna copiada porque es lo único que
 * tiene que seguir al ticket: si se renumerara, un folio congelado en el aviso
 * mandaría a buscar algo que no existe. El título sí va congelado, y esa
 * diferencia es deliberada —ver la nota de la tabla—.
 */
export async function misAvisos(limite = 20): Promise<AvisoEnPantalla[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const db = await tenantDb();
  return db
    .select({
      id: notifications.id,
      ticketId: notifications.ticketId,
      reference: tickets.reference,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(tickets, eq(tickets.id, notifications.ticketId))
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limite);
}

/** Cuántos sin leer. Es el número del punto rojo, y nada más. */
export async function contarSinLeer(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) return 0;
  const db = await tenantDb();
  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)),
    );
  return fila?.n ?? 0;
}

/**
 * Marca como leídos. Sin `ids`, todos los míos.
 *
 * El `where` lleva SIEMPRE el id de quien pregunta, y no solo los ids
 * recibidos: llegan de un formulario, o sea de fuera, y sin esa condición
 * cualquiera podría marcarle los avisos como leídos a otra persona — que es
 * pequeño como daño y grande como agujero, porque el siguiente uso de esa misma
 * forma podría no ser marcar.
 */
export async function marcarLeidos(ids?: string[]): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) return 0;
  const db = await tenantDb();
  const filas = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
        ids && ids.length > 0 ? inArray(notifications.id, ids) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return filas.length;
}
