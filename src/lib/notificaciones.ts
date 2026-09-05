import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/tenancy/context";
import { notifications, tickets, viaticos } from "@/lib/db/schema";
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

/**
 * Los sucesos que alimentan la bandeja. Cerrado a propósito.
 *
 * Los de viático son cinco y no cuatro porque el flujo tiene dos rondas de ida
 * y vuelta: se pide y se autoriza (o se rechaza), se comprueba y se cierra (o
 * se devuelve). Cada uno de esos momentos deja a alguien esperando, y quien
 * espera es precisamente quien tiene que enterarse.
 */
export const TIPOS_DE_AVISO = [
  "ticket.creado",
  "ticket.comentado",
  "ticket.asignado",
  "ticket.resuelto",
  "viatico.enviado",
  "viatico.autorizado",
  "viatico.rechazado",
  "viatico.comprobado",
  "viatico.devuelto",
  "viatico.cerrado",
] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

/**
 * De qué habla el aviso.
 *
 * Exactamente una de las dos llaves, y lo hace cumplir un CHECK en la base
 * —ver la migración 0026—. El tipo lo dice con una unión discriminada para que
 * el compilador no deje construir un aviso con las dos ni con ninguna: un aviso
 * sin asunto es un renglón en la campana que no lleva a ningún lado.
 */
export type AsuntoDelAviso =
  | { ticketId: string; viaticoId?: never }
  | { viaticoId: string; ticketId?: never };

export type AvisoNuevo = AsuntoDelAviso & {
  /** A quiénes. Una fila por cada uno: `read_at` es de cada persona. */
  paraUsuarios: string[];
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
        ticketId: aviso.ticketId ?? null,
        viaticoId: aviso.viaticoId ?? null,
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
  /**
   * A dónde lleva el renglón, ya resuelto.
   *
   * Antes la campana armaba la dirección a mano —`/tickets/${ticketId}`— y eso
   * dejó de valer en cuanto hubo avisos que no son de tickets: el componente
   * habría mandado a `/tickets/undefined`. Es la misma lección de `menu.ts`:
   * a dónde lleva algo es una decisión del modelo, no del que dibuja.
   */
  href: string;
  /** El folio del asunto: `EVO-000123` o `EVO-V-000045`. */
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
  try {
    return await leerAvisos(session.user.id, limite);
  } catch (e) {
    // LA CAMPANA NO PUEDE TUMBAR EL PORTAL.
    //
    // Esto se lee en el layout, o sea en TODAS las pantallas: una excepción
    // aquí no deja sin campana, deja sin aplicación —cada página respondería
    // 500 para todos los clientes a la vez—. El caso real es un despliegue
    // cuyo esquema de inquilino va por detrás del código, que es lo que estuvo
    // a punto de pasar cuando el contenedor de migraciones solo corría el plano
    // de control.
    //
    // Degradar a «no hay avisos» es la caída correcta: se pierde un adorno de
    // la barra y el sistema entero sigue en pie. Mismo criterio que los avisos
    // por correo, que tampoco tumban la acción que los disparó.
    console.error("[avisos] no se pudieron leer", e);
    return [];
  }
}

/**
 * Los avisos de una persona, con su destino resuelto.
 *
 * ── LOS DOS JOIN SON `left` Y ESO ES LO IMPORTANTE ────────────────────────
 *
 * Este `select` tenía un `innerJoin` contra `tickets`, que era correcto cuando
 * todos los avisos eran de tickets. Con la bandeja ampliada a viáticos, ese
 * mismo `innerJoin` habría hecho DESAPARECER en silencio cada aviso de viático:
 * la campana seguiría funcionando, el contador de no leídos los seguiría
 * contando, y el renglón no estaría. Un punto rojo sobre una lista que no lo
 * explica es peor que no avisar.
 *
 * Con `left`, un aviso cuyo asunto se borró sale igual —sin folio— en vez de
 * evaporarse. La cascada debería impedirlo, pero la campana no es el sitio
 * donde conviene averiguar si la cascada funciona.
 */
async function leerAvisos(
  userId: string,
  limite: number,
): Promise<AvisoEnPantalla[]> {
  const db = await tenantDb();
  const filas = await db
    .select({
      id: notifications.id,
      ticketId: notifications.ticketId,
      viaticoId: notifications.viaticoId,
      ticketRef: tickets.reference,
      viaticoRef: viaticos.reference,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(tickets, eq(tickets.id, notifications.ticketId))
    .leftJoin(viaticos, eq(viaticos.id, notifications.viaticoId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limite);

  return filas.map((f) => ({
    id: f.id,
    href: f.viaticoId
      ? `/admin/viaticos/${f.viaticoId}`
      : `/tickets/${f.ticketId}`,
    reference: f.viaticoRef ?? f.ticketRef ?? null,
    kind: f.kind,
    title: f.title,
    body: f.body,
    readAt: f.readAt,
    createdAt: f.createdAt,
  }));
}

/** Cuántos sin leer. Es el número del punto rojo, y nada más. */
export async function contarSinLeer(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) return 0;
  try {
    const db = await tenantDb();
    const [fila] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)),
      );
    return fila?.n ?? 0;
  } catch (e) {
    // Cae a cero por lo mismo que `misAvisos` cae a lista vacía: esto se
    // pregunta en el layout de todas las pantallas.
    console.error("[avisos] no se pudo contar", e);
    return 0;
  }
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
