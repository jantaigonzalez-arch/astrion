"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { puedeEn, tenantDb } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { saveReceipt } from "@/lib/uploads";
import { VIATICO_CATEGORIAS } from "@/lib/viaticos";
import {
  addExpense,
  approveViatico,
  cancelViatico,
  closeViatico,
  createViatico,
  reassignViatico,
  reclassifyExpense,
  rejectViatico,
  removeExpense,
  reportViatico,
  returnViatico,
  submitViatico,
  type AsuntoViatico,
  type DestinoGasto,
} from "@/lib/domain/viaticos";

/**
 * Acciones de viáticos.
 *
 * EL REPARTO DE PERMISOS ES EL MÓDULO, igual que en requisiciones. El ingeniero
 * PIDE y COMPRUEBA con `viaticos:editar`; solo `viaticos:administrar` AUTORIZA y
 * da el visto bueno. Y ni siquiera eso alcanza: quien administra tampoco puede
 * firmar lo que pidió él mismo, y eso lo comprueba `lib/domain/viaticos.ts`
 * —aquí no, porque una regla escrita en la acción se salta desde la siguiente
 * acción que alguien escriba—.
 *
 * Estas funciones hacen tres cosas y ninguna más: comprobar el permiso de
 * módulo, sanear la entrada y llamar al dominio dentro de una transacción. La
 * decisión de si la transición es legal vive del otro lado.
 */

export type ViaticoState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** Recién creado, para que la pantalla navegue a él. */
  viaticoId?: string;
};

const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

/**
 * Importe en pesos, tal como lo teclea una persona.
 *
 * Se limpian comas y el signo de pesos antes de convertir: «$1,250.00» es lo
 * que sale de copiar una cifra de una factura, y `Number()` a secas lo convierte
 * en `NaN` — que sin esto acabaría guardado como un error de restricción en vez
 * de como un mensaje que se entiende.
 */
function importe(v: FormDataEntryValue | null): number | null {
  const limpio = String(v ?? "").replace(/[$,\s]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

async function quien() {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Lo que devuelven los dos lectores de abajo.
 *
 * `{ error }` o `{ valor }`, nunca los dos: es la forma que ya usa el dominio
 * con `{ ok, reason }`, y aquí sirve para lo mismo —quien llama pregunta si hay
 * error y no tiene que acordarse de comprobar un nulo—.
 */
type Leido<T> = { valor: T } | { error: string };

/**
 * EL ASUNTO DEL VIÁTICO, tal como llega del formulario.
 *
 * Aquí solo se sanea la forma; que la empresa permita viajar a prospectos y que
 * quien pide pueda hacerlo lo decide `domain/viaticos.ts`. Es la separación de
 * siempre: la acción no toma decisiones de negocio, porque una decisión tomada
 * aquí no vale para el script que escriba alguien en marzo.
 */
function asuntoDelFormulario(formData: FormData): Leido<AsuntoViatico> {
  const tipo = String(formData.get("asunto") ?? "contrato");

  if (tipo === "prospecto") {
    const organizationId = uuid.safeParse(formData.get("organizationId"));
    if (!organizationId.success) return { error: "Elige un prospecto." };
    // El negocio es opcional: se prospecta antes de que haya oportunidad
    // abierta. Un uuid inválido se trata como «ninguno» y no como error —el
    // selector trae la opción vacía, y esa es la que manda el navegador—.
    const dealId = uuid.safeParse(formData.get("dealId"));
    return {
      valor: {
        tipo: "prospecto",
        organizationId: organizationId.data,
        dealId: dealId.success ? dealId.data : null,
      },
    };
  }

  const contractId = uuid.safeParse(formData.get("contractId"));
  if (!contractId.success) return { error: "Elige un contrato." };
  return { valor: { tipo: "contrato", contractId: contractId.data } };
}

/**
 * A DÓNDE VA EL GASTO: ticket, negocio o ninguno de los dos.
 *
 * «Ninguno» es una respuesta y no una omisión, así que se escribe: el
 * formulario manda `destino=comercial` en vez de dejar el campo vacío. Un campo
 * vacío no distingue «es gasto del viaje» de «se me olvidó elegir», y esa
 * diferencia es justo la que quien revisa necesita ver.
 */
function destinoDelFormulario(formData: FormData): Leido<DestinoGasto> {
  const tipo = String(formData.get("destino") ?? "ticket");

  if (tipo === "comercial") return { valor: { tipo: "comercial" } };

  if (tipo === "negocio") {
    const dealId = uuid.safeParse(formData.get("dealId"));
    if (!dealId.success) return { error: "Elige el negocio al que se carga el gasto." };
    return { valor: { tipo: "negocio", dealId: dealId.data } };
  }

  const ticketId = uuid.safeParse(formData.get("ticketId"));
  if (!ticketId.success) {
    return { error: "Elige a qué ticket de servicio pertenece el gasto." };
  }
  return { valor: { tipo: "ticket", ticketId: ticketId.data } };
}

/* ───────────────────────── Alta y envío ───────────────────────── */

export async function crearViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  if (!(await puedeEn("viaticos", "editar"))) {
    return { ok: false, error: "No tienes permiso para pedir viáticos." };
  }

  const asunto = asuntoDelFormulario(formData);
  if ("error" in asunto) return { ok: false, error: asunto.error };

  const approverId = uuid.safeParse(formData.get("approverId"));
  if (!approverId.success) {
    return { ok: false, error: "Elige a quién le mandas el viático a firmar." };
  }

  const destination = String(formData.get("destination") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  if (!destination) return { ok: false, error: "Falta el destino." };
  if (!purpose) return { ok: false, error: "Falta el motivo del viaje." };

  const departsOn = fecha.safeParse(formData.get("departsOn"));
  const returnsOn = fecha.safeParse(formData.get("returnsOn"));
  if (!departsOn.success) return { ok: false, error: "Falta la fecha de salida." };
  if (!returnsOn.success) return { ok: false, error: "Falta la fecha de regreso." };

  const estimado = importe(formData.get("estimatedMxn"));
  if (estimado === null || estimado <= 0) {
    return { ok: false, error: "Pon un monto estimado mayor que cero." };
  }

  const moduleIds = formData
    .getAll("moduleIds")
    .map(String)
    .filter((s) => uuid.safeParse(s).success);

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      createViatico(tx, {
        asunto: asunto.valor,
        requestedById: userId,
        approverId: approverId.data,
        destination,
        purpose,
        departsOn: departsOn.data,
        returnsOn: returnsOn.data,
        estimatedMxn: estimado,
        moduleIds,
      }),
    );
    if (!res.ok) return { ok: false, error: res.reason };
    revalidateTenant();
    return { ok: true, message: "Viático creado.", viaticoId: res.id };
  } catch (e) {
    console.error("[viaticos] alta", e);
    return { ok: false, error: "No se pudo crear el viático." };
  }
}

export async function enviarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  const db = await tenantDb();
  const res = await db.transaction((tx) => submitViatico(tx, id.data, userId));
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Enviado. Le llegó a quien autoriza." };
}

/* ─────────────────────── Etapa 1 · firma ─────────────────────── */

export async function autorizarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  // El permiso de MÓDULO se resuelve aquí; si además puede firmar ESTE viático
  // —no ser quien lo pidió— lo decide el dominio. Son dos preguntas distintas y
  // se contestan en dos sitios distintos a propósito.
  const puede = await puedeEn("viaticos", "administrar");
  if (!puede) return { ok: false, error: "No tienes permiso para autorizar viáticos." };

  const monto = importe(formData.get("authorizedMxn"));
  if (monto === null) return { ok: false, error: "Pon el monto que autorizas." };

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    approveViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      authorizedMxn: monto,
      note: String(formData.get("note") ?? ""),
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Autorizado." };
}

export async function rechazarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  // El permiso de MÓDULO se resuelve aquí; si además puede firmar ESTE viático
  // —no ser quien lo pidió— lo decide el dominio. Son dos preguntas distintas y
  // se contestan en dos sitios distintos a propósito.
  const puede = await puedeEn("viaticos", "administrar");
  if (!puede) return { ok: false, error: "No tienes permiso para rechazar viáticos." };

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    rejectViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Rechazado. Se le avisó a quien lo pidió." };
}

/* ─────────────────── Etapa 2 · gastos y cierre ─────────────────── */

export async function agregarGastoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  if (!(await puedeEn("viaticos", "editar"))) {
    return { ok: false, error: "No tienes permiso para capturar gastos." };
  }

  const viaticoId = uuid.safeParse(formData.get("viaticoId"));
  if (!viaticoId.success) return { ok: false, error: "Viático inválido." };

  const destino = destinoDelFormulario(formData);
  if ("error" in destino) return { ok: false, error: destino.error };

  const category = z.enum(VIATICO_CATEGORIAS).safeParse(formData.get("category"));
  if (!category.success) return { ok: false, error: "Elige una categoría." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "Describe el gasto." };

  const monto = importe(formData.get("amountMxn"));
  if (monto === null || monto <= 0) {
    return { ok: false, error: "Pon un importe mayor que cero." };
  }

  const spentOn = fecha.safeParse(formData.get("spentOn"));
  if (!spentOn.success) return { ok: false, error: "Falta la fecha del gasto." };

  let receiptPath: string | null = null;
  try {
    receiptPath = await saveReceipt(formData.get("receipt"), "viaticos");
  } catch (e) {
    // El formato del comprobante lo dice `saveReceipt` con sus palabras, y hay
    // que dejarlas pasar: «no se pudo guardar» no le dice a nadie que el
    // problema es que subió un .docx.
    return { ok: false, error: (e as Error).message };
  }

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    addExpense(
      tx,
      {
        viaticoId: viaticoId.data,
        destino: destino.valor,
        category: category.data,
        otherLabel: String(formData.get("otherLabel") ?? ""),
        description,
        amountMxn: monto,
        spentOn: spentOn.data,
        receiptPath,
      },
      userId,
    ),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return {
    ok: true,
    message: receiptPath ? "Gasto agregado." : "Gasto agregado, SIN comprobante.",
  };
}

export async function quitarGastoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("gastoId"));
  if (!id.success) return { ok: false, error: "Gasto inválido." };

  const db = await tenantDb();
  const res = await db.transaction((tx) => removeExpense(tx, id.data, userId));
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Gasto quitado." };
}

export async function mandarARevisionAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  const db = await tenantDb();
  const res = await db.transaction((tx) => reportViatico(tx, id.data, userId));
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Comprobación enviada a revisión." };
}

export async function cerrarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  // El permiso de MÓDULO se resuelve aquí; si además puede firmar ESTE viático
  // —no ser quien lo pidió— lo decide el dominio. Son dos preguntas distintas y
  // se contestan en dos sitios distintos a propósito.
  const puede = await puedeEn("viaticos", "administrar");
  if (!puede) return { ok: false, error: "No tienes permiso para dar el visto bueno viáticos." };

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    closeViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      note: String(formData.get("note") ?? ""),
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Cerrado. El gasto ya cuenta en la utilidad del contrato." };
}

export async function devolverViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  // El permiso de MÓDULO se resuelve aquí; si además puede firmar ESTE viático
  // —no ser quien lo pidió— lo decide el dominio. Son dos preguntas distintas y
  // se contestan en dos sitios distintos a propósito.
  const puede = await puedeEn("viaticos", "administrar");
  if (!puede) return { ok: false, error: "No tienes permiso para devolver viáticos." };

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    returnViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Devuelto para corregir." };
}

/**
 * Mandarle el viático a otra persona para que lo firme.
 *
 * Pide `administrar` como cualquier otra decisión de firma. No pide ser el
 * aprobador actual, y ese es el caso que resuelve: el aprobador actual no está.
 */
export async function reasignarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  const approverId = uuid.safeParse(formData.get("approverId"));
  if (!approverId.success) return { ok: false, error: "Elige a quién se lo pasas." };

  const puede = await puedeEn("viaticos", "administrar");

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    reassignViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      approverId: approverId.data,
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Reasignado. Le llegó el aviso." };
}

/**
 * Mover un gasto de destino mientras se revisa la comprobación.
 *
 * Es la decisión de quien firma —a qué se carga esta cena—, así que exige
 * `administrar` igual que autorizar o cerrar. El resto de las condiciones
 * (estado del viático, que el negocio sea del prospecto) las pone el dominio.
 */
export async function reclasificarGastoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  if (!(await puedeEn("viaticos", "administrar"))) {
    return { ok: false, error: "No tienes permiso para reclasificar gastos." };
  }

  const gastoId = uuid.safeParse(formData.get("gastoId"));
  if (!gastoId.success) return { ok: false, error: "Gasto inválido." };

  const destino = destinoDelFormulario(formData);
  if ("error" in destino) return { ok: false, error: destino.error };

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    reclassifyExpense(tx, {
      expenseId: gastoId.data,
      actorId: userId,
      puedeAdministrar: true,
      destino: destino.valor,
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Gasto reclasificado." };
}

export async function cancelarViaticoAction(
  _prev: ViaticoState,
  formData: FormData,
): Promise<ViaticoState> {
  const userId = await quien();
  if (!userId) return { ok: false, error: "No hay sesión." };
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Viático inválido." };

  // Aquí NO se bloquea por el permiso: cancelar también lo puede hacer quien
  // pidió el viático porque se le cayó el viaje, y esa es la vía normal. El
  // dominio admite las dos y rechaza a cualquier otro.
  const puede = await puedeEn("viaticos", "administrar");

  const db = await tenantDb();
  const res = await db.transaction((tx) =>
    cancelViatico(tx, {
      id: id.data,
      actorId: userId,
      puedeAdministrar: puede,
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  if (!res.ok) return { ok: false, error: res.reason };
  revalidateTenant();
  return { ok: true, message: "Cancelado." };
}
