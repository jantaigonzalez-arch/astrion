import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { viaticoExpenses, viaticos } from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import { ajustesGuardados, nivelEfectivo } from "@/lib/permisos";
import { nextViaticoReference } from "@/lib/domain/references";
import { crearAvisos } from "@/lib/notificaciones";
import type { ViaticoEstado } from "@/lib/viaticos";

/**
 * LAS TRANSICIONES DE UN VIÁTICO, con sus guardias.
 *
 * Todo lo que mueve un viático de estado pasa por aquí, y no por las acciones
 * de servidor. La razón es la de siempre en este repositorio: una regla escrita
 * en la acción se puede saltar desde otra acción, desde un script o desde el
 * importador que alguien escriba en marzo. Escrita aquí, hay un solo sitio
 * donde comprobar que se cumple.
 *
 * ── LA REGLA QUE SOSTIENE EL MÓDULO ────────────────────────────────────────
 *
 * QUIEN PIDE NO FIRMA. Ni la autorización ni el visto bueno pueden ser de la
 * misma persona que levantó el viático, aunque tenga permiso de administrar
 * viáticos —el caso real es el administrador que también viaja—.
 *
 * No lo impide la base porque no puede: depende de qué permisos tiene quien
 * firma, y eso vive en `memberships`, en el plano de control, en otro esquema.
 * Lo impide `firmaValida()`, y por eso todas las transiciones de firma pasan
 * por ella en vez de comprobarlo cada una por su cuenta.
 *
 * ── LOS RESULTADOS SON DATOS, NO EXCEPCIONES ───────────────────────────────
 *
 * `{ ok: false, reason }` y no `throw`, igual que en requisiciones: un estado
 * equivocado es una respuesta legítima de esta capa —«esto ya lo autorizó
 * alguien»— y no un fallo del programa. La pantalla lo enseña; una excepción
 * habría que atraparla para hacer lo mismo.
 */

export type Resultado =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/** El estado del que se puede salir hacia cada transición. */
const DESDE: Record<string, readonly ViaticoEstado[]> = {
  enviar: ["borrador"],
  autorizar: ["enviado"],
  rechazar: ["enviado"],
  comprobar: ["autorizado"],
  cerrar: ["en_revision"],
  devolver: ["en_revision"],
  cancelar: ["borrador", "enviado", "autorizado"],
};

/**
 * A QUIÉN LE LLEGA UNA SOLICITUD.
 *
 * ── POR CAPACIDAD, NO POR ETIQUETA DE ROL ──────────────────────────────────
 *
 * La pregunta del negocio es «quien tenga el rol General», y aquí se resuelve
 * como «quien pueda ADMINISTRAR viáticos». Con la tabla de permisos de fábrica
 * eso es exactamente el rol General —más el administrador y el dueño, que
 * siempre pudieron—, así que hoy las dos preguntas dan la misma lista.
 *
 * Dejan de darla en cuanto alguien usa los ajustes por persona, que existen
 * justamente para eso: al agente veterano al que se le da `viaticos:
 * administrar` sin convertirlo en General, buscar por rol lo dejaría invisible
 * —podría autorizar, y no le llegaría nada que autorizar—. Es la misma lección
 * que ya está escrita en `portal/menu.ts`: filtrar por `puedeEntrar` y no por
 * el rol es lo que impide que la barra y el guardia discrepen.
 *
 * Se excluye a quien pide: mandarle a alguien el aviso de su propia solicitud
 * es ruido, y además no puede firmarla.
 */
export async function quienesAutorizan(exceptoId?: string): Promise<string[]> {
  const gente = await listTenantMembers();
  return gente
    .filter(
      (m) =>
        m.id !== exceptoId &&
        nivelEfectivo(m.role, ajustesGuardados(m.permissions), "viaticos") ===
          "administrar",
    )
    .map((m) => m.id);
}

/**
 * ¿Puede esta persona firmar ESTE viático?
 *
 * Dos condiciones, y la segunda es la que importa: hay que poder administrar
 * viáticos, y no haber sido quien lo pidió. Ver la cabecera.
 */
function firmaValida(
  v: { requestedById: string },
  actorId: string,
  puedeAdministrar: boolean,
): string | null {
  if (!puedeAdministrar) return "No tienes permiso para autorizar viáticos.";
  if (v.requestedById === actorId) {
    return "No puedes firmar un viático que pediste tú. Tiene que revisarlo otra persona.";
  }
  return null;
}

async function cargar(tx: DbOrTx, id: string) {
  const [v] = await tx
    .select({
      id: viaticos.id,
      reference: viaticos.reference,
      status: viaticos.status,
      requestedById: viaticos.requestedById,
      estimatedMxn: viaticos.estimatedMxn,
      authorizedMxn: viaticos.authorizedMxn,
    })
    .from(viaticos)
    .where(eq(viaticos.id, id))
    .limit(1);
  return v ?? null;
}

/** Lo que se comprobó hasta ahora. Se recalcula, no se cachea. */
async function totalGastado(tx: DbOrTx, viaticoId: string): Promise<number> {
  const [f] = await tx
    .select({ n: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8` })
    .from(viaticoExpenses)
    .where(eq(viaticoExpenses.viaticoId, viaticoId));
  return Number(f?.n ?? 0);
}

/* ═════════════════════════════ Alta ═════════════════════════════ */

export type NuevoViatico = {
  contractId: string;
  requestedById: string;
  destination: string;
  purpose: string;
  departsOn: string;
  returnsOn: string;
  estimatedMxn: number;
  /** Módulos del contrato que se van a atender. Puede ir vacío. */
  moduleIds: string[];
};

export async function createViatico(
  tx: DbOrTx,
  input: NuevoViatico,
): Promise<Resultado> {
  if (input.returnsOn < input.departsOn) {
    return { ok: false, reason: "El regreso no puede ser antes de la salida." };
  }
  if (!(input.estimatedMxn > 0)) {
    return { ok: false, reason: "El monto estimado tiene que ser mayor que cero." };
  }

  const reference = await nextViaticoReference(tx);
  const [fila] = await tx
    .insert(viaticos)
    .values({
      reference,
      contractId: input.contractId,
      requestedById: input.requestedById,
      destination: input.destination,
      purpose: input.purpose,
      departsOn: input.departsOn,
      returnsOn: input.returnsOn,
      estimatedMxn: input.estimatedMxn.toFixed(2),
    })
    .returning({ id: viaticos.id });

  await guardarModulos(tx, fila.id, input.moduleIds);
  return { ok: true, id: fila.id };
}

/**
 * Reemplaza los módulos declarados.
 *
 * Borra y vuelve a insertar en vez de calcular la diferencia: son cero a diez
 * filas sin datos propios, y una diferencia bien hecha aquí sería más código
 * que el que ahorra. Va dentro de la transacción de quien llama, así que nadie
 * puede leer el momento en que la lista está vacía.
 */
export async function guardarModulos(
  tx: DbOrTx,
  viaticoId: string,
  moduleIds: string[],
): Promise<void> {
  const { viaticoModules } = await import("@/lib/db/schema");
  await tx.delete(viaticoModules).where(eq(viaticoModules.viaticoId, viaticoId));
  const unicos = [...new Set(moduleIds.filter(Boolean))];
  if (unicos.length === 0) return;
  await tx
    .insert(viaticoModules)
    .values(unicos.map((moduleId) => ({ viaticoId, moduleId })));
}

/* ═══════════════════════ Etapa 1 · autorización ═══════════════════════ */

/** El ingeniero manda su solicitud. A partir de aquí no la puede editar. */
export async function submitViatico(
  tx: DbOrTx,
  id: string,
  actorId: string,
): Promise<Resultado> {
  const v = await cargar(tx, id);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (v.requestedById !== actorId) {
    return { ok: false, reason: "Solo quien lo pidió puede enviarlo." };
  }
  if (!DESDE.enviar.includes(v.status)) {
    return { ok: false, reason: `No se puede enviar: está en «${v.status}».` };
  }

  await tx
    .update(viaticos)
    .set({ status: "enviado", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(viaticos.id, id));

  await crearAvisos({
    paraUsuarios: await quienesAutorizan(actorId),
    viaticoId: id,
    tipo: "viatico.enviado",
    titulo: `Viático ${v.reference} espera autorización`,
    cuerpo: "Una solicitud de viáticos necesita tu firma.",
  });

  return { ok: true, id };
}

export async function approveViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    /** Lo que se autoriza de verdad, que puede no ser lo que se pidió. */
    authorizedMxn: number;
    note?: string | null;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };

  const veto = firmaValida(v, args.actorId, args.puedeAdministrar);
  if (veto) return { ok: false, reason: veto };
  if (!DESDE.autorizar.includes(v.status)) {
    return { ok: false, reason: `No se puede autorizar: está en «${v.status}».` };
  }
  if (!(args.authorizedMxn > 0)) {
    return {
      ok: false,
      reason: "Autorizar cero es rechazar. Usa «Rechazar» y di por qué.",
    };
  }

  await tx
    .update(viaticos)
    .set({
      status: "autorizado",
      approvedById: args.actorId,
      approvedAt: new Date(),
      authorizedMxn: args.authorizedMxn.toFixed(2),
      approvalNote: args.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(viaticos.id, args.id));

  const pedido = Number(v.estimatedMxn);
  await crearAvisos({
    paraUsuarios: [v.requestedById],
    viaticoId: args.id,
    tipo: "viatico.autorizado",
    titulo: `Viático ${v.reference} autorizado`,
    cuerpo:
      args.authorizedMxn < pedido
        ? `Se autorizaron $${args.authorizedMxn.toFixed(2)} de los $${pedido.toFixed(2)} solicitados.`
        : "Ya puedes cargar tus gastos.",
  });

  return { ok: true, id: args.id };
}

export async function rejectViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    reason: string;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };

  const veto = firmaValida(v, args.actorId, args.puedeAdministrar);
  if (veto) return { ok: false, reason: veto };
  if (!DESDE.rechazar.includes(v.status)) {
    return { ok: false, reason: `No se puede rechazar: está en «${v.status}».` };
  }
  // Un rechazo sin motivo obliga a quien pidió a adivinar qué corregir, y lo
  // que hace en la práctica es volver a mandar lo mismo.
  const motivo = args.reason.trim();
  if (!motivo) return { ok: false, reason: "Hay que decir por qué se rechaza." };

  await tx
    .update(viaticos)
    .set({
      status: "rechazado",
      approvedById: args.actorId,
      approvedAt: new Date(),
      resolutionReason: motivo,
      updatedAt: new Date(),
    })
    .where(eq(viaticos.id, args.id));

  await crearAvisos({
    paraUsuarios: [v.requestedById],
    viaticoId: args.id,
    tipo: "viatico.rechazado",
    titulo: `Viático ${v.reference} rechazado`,
    cuerpo: motivo,
  });

  return { ok: true, id: args.id };
}

/* ═══════════════════════ Etapa 2 · comprobación ═══════════════════════ */

/** El ingeniero da por terminada su comprobación y la manda a revisar. */
export async function reportViatico(
  tx: DbOrTx,
  id: string,
  actorId: string,
): Promise<Resultado> {
  const v = await cargar(tx, id);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (v.requestedById !== actorId) {
    return { ok: false, reason: "Solo quien viajó puede mandar su comprobación." };
  }
  if (!DESDE.comprobar.includes(v.status)) {
    return { ok: false, reason: `No se puede comprobar: está en «${v.status}».` };
  }

  // Mandar a revisar una comprobación vacía le hace perder el viaje a quien
  // revisa, y deja el documento en un estado del que solo se sale devolviéndolo.
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(viaticoExpenses)
    .where(eq(viaticoExpenses.viaticoId, id));
  if (!n) {
    return { ok: false, reason: "Carga al menos un gasto antes de mandar a revisar." };
  }

  await tx
    .update(viaticos)
    .set({ status: "en_revision", reportedAt: new Date(), updatedAt: new Date() })
    .where(eq(viaticos.id, id));

  const gastado = await totalGastado(tx, id);
  await crearAvisos({
    paraUsuarios: await quienesAutorizan(actorId),
    viaticoId: id,
    tipo: "viatico.comprobado",
    titulo: `Viático ${v.reference} espera visto bueno`,
    cuerpo: `${n} gasto(s) por $${gastado.toFixed(2)}.`,
  });

  return { ok: true, id };
}

/**
 * Visto bueno: se cierra y el gasto empieza a contar en la utilidad.
 *
 * Que sea el cierre —y no la autorización— lo que hace contar el gasto es
 * deliberado: un anticipo autorizado todavía no es un costo, es dinero
 * entregado que puede volver. Contarlo antes inflaría el costo de todos los
 * contratos con un viaje en curso. Ver `data/viaticos.ts`.
 */
export async function closeViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    note?: string | null;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };

  const veto = firmaValida(v, args.actorId, args.puedeAdministrar);
  if (veto) return { ok: false, reason: veto };
  if (!DESDE.cerrar.includes(v.status)) {
    return { ok: false, reason: `No se puede cerrar: está en «${v.status}».` };
  }

  await tx
    .update(viaticos)
    .set({
      status: "cerrado",
      closedById: args.actorId,
      closedAt: new Date(),
      closingNote: args.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(viaticos.id, args.id));

  const gastado = await totalGastado(tx, args.id);
  const anticipo = Number(v.authorizedMxn ?? 0);
  const saldo = anticipo - gastado;
  await crearAvisos({
    paraUsuarios: [v.requestedById],
    viaticoId: args.id,
    tipo: "viatico.cerrado",
    titulo: `Viático ${v.reference} cerrado`,
    cuerpo:
      saldo > 0
        ? `Quedan $${saldo.toFixed(2)} por devolver a la empresa.`
        : saldo < 0
          ? `Se te reembolsan $${Math.abs(saldo).toFixed(2)}.`
          : "El cuadre salió exacto.",
  });

  return { ok: true, id: args.id };
}

/**
 * Devolver la comprobación: falta un comprobante, sobra un gasto.
 *
 * Regresa a `autorizado`, que es exactamente donde estaba — le faltan gastos o
 * papeles. No hay un estado «devuelto» porque el trabajo pendiente es el mismo
 * y el motivo ya vive en `resolutionReason`; un estado más solo serviría para
 * que alguien tuviera que aprender qué lo distingue.
 */
export async function returnViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    reason: string;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };

  const veto = firmaValida(v, args.actorId, args.puedeAdministrar);
  if (veto) return { ok: false, reason: veto };
  if (!DESDE.devolver.includes(v.status)) {
    return { ok: false, reason: `No se puede devolver: está en «${v.status}».` };
  }
  const motivo = args.reason.trim();
  if (!motivo) return { ok: false, reason: "Hay que decir qué falta corregir." };

  await tx
    .update(viaticos)
    .set({
      status: "autorizado",
      reportedAt: null,
      resolutionReason: motivo,
      updatedAt: new Date(),
    })
    .where(eq(viaticos.id, args.id));

  await crearAvisos({
    paraUsuarios: [v.requestedById],
    viaticoId: args.id,
    tipo: "viatico.devuelto",
    titulo: `Viático ${v.reference} devuelto para corregir`,
    cuerpo: motivo,
  });

  return { ok: true, id: args.id };
}

/**
 * Cancelar.
 *
 * Lo puede hacer quien pidió —se canceló el viaje— o quien administra. No se
 * borra la fila: un viático cancelado después de autorizado dejó un anticipo
 * entregado, y borrarlo haría desaparecer el rastro de ese dinero.
 */
export async function cancelViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    reason: string;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (v.requestedById !== args.actorId && !args.puedeAdministrar) {
    return { ok: false, reason: "No puedes cancelar este viático." };
  }
  if (!DESDE.cancelar.includes(v.status)) {
    return { ok: false, reason: `No se puede cancelar: está en «${v.status}».` };
  }
  const motivo = args.reason.trim();
  if (!motivo) return { ok: false, reason: "Hay que decir por qué se cancela." };

  await tx
    .update(viaticos)
    .set({ status: "cancelado", resolutionReason: motivo, updatedAt: new Date() })
    .where(eq(viaticos.id, args.id));

  return { ok: true, id: args.id };
}

/* ═════════════════════════ Gastos ═════════════════════════ */

export type NuevoGasto = {
  viaticoId: string;
  ticketId: string;
  category: "hotel" | "transporte" | "comida" | "refacciones" | "otros";
  otherLabel?: string | null;
  description: string;
  amountMxn: number;
  spentOn: string;
  receiptPath?: string | null;
};

/**
 * Cargar un gasto.
 *
 * Solo el solicitante, y solo mientras el viático está `autorizado`. Después de
 * mandarlo a revisar, añadir un renglón cambiaría lo que quien revisa está
 * mirando en ese momento — y el visto bueno se daría sobre otra cosa.
 */
export async function addExpense(
  tx: DbOrTx,
  gasto: NuevoGasto,
  actorId: string,
): Promise<Resultado> {
  const v = await cargar(tx, gasto.viaticoId);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (v.requestedById !== actorId) {
    return { ok: false, reason: "Solo quien viajó carga sus gastos." };
  }
  if (v.status !== "autorizado") {
    return {
      ok: false,
      reason:
        v.status === "en_revision"
          ? "Ya está en revisión. Pide que te lo devuelvan para cambiar algo."
          : `No se pueden cargar gastos: está en «${v.status}».`,
    };
  }
  if (!(gasto.amountMxn > 0)) {
    return { ok: false, reason: "El importe tiene que ser mayor que cero." };
  }
  // El mismo CHECK vive en la base. Aquí está para poder decirlo con palabras
  // en vez de que salga un error de restricción.
  if (gasto.category === "otros" && !gasto.otherLabel?.trim()) {
    return { ok: false, reason: "En «Otros» hay que especificar de qué se trata." };
  }

  const [fila] = await tx
    .insert(viaticoExpenses)
    .values({
      viaticoId: gasto.viaticoId,
      ticketId: gasto.ticketId,
      category: gasto.category,
      otherLabel: gasto.category === "otros" ? gasto.otherLabel!.trim() : null,
      description: gasto.description,
      amountMxn: gasto.amountMxn.toFixed(2),
      spentOn: gasto.spentOn,
      receiptPath: gasto.receiptPath ?? null,
    })
    .returning({ id: viaticoExpenses.id });

  return { ok: true, id: fila.id };
}

/** Quitar un gasto. Mismas condiciones que ponerlo. */
export async function removeExpense(
  tx: DbOrTx,
  expenseId: string,
  actorId: string,
): Promise<Resultado> {
  const [g] = await tx
    .select({ id: viaticoExpenses.id, viaticoId: viaticoExpenses.viaticoId })
    .from(viaticoExpenses)
    .where(eq(viaticoExpenses.id, expenseId))
    .limit(1);
  if (!g) return { ok: false, reason: "El gasto no existe." };

  const v = await cargar(tx, g.viaticoId);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (v.requestedById !== actorId) {
    return { ok: false, reason: "Solo quien viajó puede quitar sus gastos." };
  }
  if (v.status !== "autorizado") {
    return { ok: false, reason: `No se pueden quitar gastos: está en «${v.status}».` };
  }

  await tx
    .delete(viaticoExpenses)
    .where(and(eq(viaticoExpenses.id, expenseId), eq(viaticoExpenses.viaticoId, g.viaticoId)));
  return { ok: true, id: expenseId };
}
