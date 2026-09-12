"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { puedeEn, tenantDb } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { saveReceipt } from "@/lib/uploads";
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
  type DestinoGasto,
  type DestinoViatico,
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
/*
  AAAA-MM-DD Y ADEMÁS UN DÍA QUE EXISTA.

  Con la expresión regular a secas, «2026-02-30» pasaba y reventaba en Postgres
  («date/time field value out of range»): en el alta lo tapaba el `catch` con un
  mensaje genérico, y en el gasto —que no tenía— tumbaba la acción entera. Se
  comprueba que la fecha dé la vuelta intacta por `Date`: un 30 de febrero se
  convierte en 2 de marzo y deja de coincidir. Lo encontró
  `scripts/_probe-acciones-viaticos.ts`.
*/
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Fecha inválida.");

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
 * LOS DESTINOS DEL VIAJE, tal como llegan del formulario.
 *
 * Llegan como una lista en JSON (`destinos`), porque el formulario arma una
 * lista de largo variable —uno o varios contratos, visitas y prospectos—, y
 * repartirla en campos con índice sería inventar un formato para decir lo que
 * JSON ya dice. Si no viene, se lee la forma de antes de la 0037 —un solo
 * asunto en `asunto`, `contractId`, `organizationId` y `dealId`—, que es la que
 * siguen mandando los enlaces y scripts viejos.
 *
 * Aquí solo se sanea la FORMA. Que la empresa permita esos destinos, cuántos y
 * a quién, lo decide `domain/viaticos.ts`: la acción no toma decisiones de
 * negocio, porque una decisión tomada aquí no vale para el script que escriba
 * alguien en marzo.
 */
const DestinoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("contrato"), contractId: uuid }),
  z.object({
    tipo: z.enum(["visita", "prospecto"]),
    organizationId: uuid,
    // Opcional: se prospecta antes de que haya oportunidad abierta. Vacío o
    // inválido cuenta como «ninguno» —el selector trae la opción vacía—.
    dealId: z.string().optional().nullable()
      .transform((v) => (v && uuid.safeParse(v).success ? v : null)),
  }),
]);

function destinosDelFormulario(formData: FormData): Leido<DestinoViatico[]> {
  const crudo = formData.get("destinos");
  if (typeof crudo === "string" && crudo.trim()) {
    let lista: unknown;
    try {
      lista = JSON.parse(crudo);
    } catch {
      return { error: "No se entendió la lista de destinos." };
    }
    const r = z.array(DestinoSchema).min(1).max(20).safeParse(lista);
    if (!r.success) {
      return { error: Array.isArray(lista) && lista.length === 0 ? "Elige al menos un destino." : "Revisa los destinos: a uno le falta el contrato o la empresa." };
    }
    return { valor: r.data };
  }

  // La forma de antes de la 0037: un solo asunto.
  const tipo = String(formData.get("asunto") ?? "contrato");
  if (tipo === "prospecto" || tipo === "visita") {
    const organizationId = uuid.safeParse(formData.get("organizationId"));
    if (!organizationId.success) {
      return { error: tipo === "prospecto" ? "Elige un prospecto." : "Elige al cliente que se visita." };
    }
    const dealId = uuid.safeParse(formData.get("dealId"));
    return {
      valor: [
        { tipo, organizationId: organizationId.data, dealId: dealId.success ? dealId.data : null },
      ],
    };
  }
  const contractId = uuid.safeParse(formData.get("contractId"));
  if (!contractId.success) return { error: "Elige un contrato." };
  return { valor: [{ tipo: "contrato", contractId: contractId.data }] };
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
  /*
    La forma de la 0037: UNA opción con el tipo delante —`ticket:<id>`,
    `negocio:<id>`, `destino:<id>` o `general`—, que es lo que manda el
    selector único de captura y de reclasificación (ver `opcionesDeGasto`).
    Sin ella se lee la forma de antes, en tres campos.
  */
  const opcion = String(formData.get("opcion") ?? "");
  if (opcion) {
    if (opcion === "general") return { valor: { tipo: "comercial", destinoId: null } };
    const [clase, id] = opcion.split(":");
    if (!uuid.safeParse(id).success) return { error: "Elige a qué se carga el gasto." };
    if (clase === "ticket") return { valor: { tipo: "ticket", ticketId: id } };
    if (clase === "negocio") return { valor: { tipo: "negocio", dealId: id } };
    if (clase === "destino") return { valor: { tipo: "comercial", destinoId: id } };
    return { error: "Elige a qué se carga el gasto." };
  }

  const tipo = String(formData.get("destino") ?? "ticket");

  if (tipo === "comercial") {
    // De qué destino del viaje es; vacío = gasto general (o el único destino).
    const destinoId = uuid.safeParse(formData.get("destinoId"));
    return { valor: { tipo: "comercial", destinoId: destinoId.success ? destinoId.data : null } };
  }

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

  const destinos = destinosDelFormulario(formData);
  if ("error" in destinos) return { ok: false, error: destinos.error };

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
        destinos: destinos.valor,
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
  /*
    Enviar es parte de PEDIR, y pedir es `viaticos: editar` —la cabecera lo dice
    y el alta lo exige—. Aquí no se comprobaba: quien había perdido el módulo
    seguía pudiendo mover su borrador. Lo encontró
    `scripts/_probe-acciones-viaticos.ts`.
  */
  if (!(await puedeEn("viaticos", "editar"))) {
    return { ok: false, error: "No tienes permiso para enviar viáticos." };
  }
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

  /*
    El `catch` es el mismo que ya tenía el alta. Un monto que no cabe en
    `numeric(12,2)` —«1e12» es un número para `Number()`— llegaba a Postgres y
    la acción reventaba en vez de contestar. Lo encontró
    `scripts/_probe-acciones-viaticos.ts`.
  */
  let res: Awaited<ReturnType<typeof approveViatico>>;
  try {
    const db = await tenantDb();
    res = await db.transaction((tx) =>
      approveViatico(tx, {
        id: id.data,
        actorId: userId,
        puedeAdministrar: puede,
        authorizedMxn: monto,
        note: String(formData.get("note") ?? ""),
      }),
    );
  } catch (e) {
    console.error("[viaticos] autorizar", e);
    return { ok: false, error: "No se pudo autorizar el viático." };
  }
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

  const rubroId = uuid.safeParse(formData.get("rubroId"));
  if (!rubroId.success) return { ok: false, error: "Elige un rubro de gasto." };

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

  /*
    Sin este `catch`, lo que pasa Zod pero no Postgres —un ticket con uuid bien
    formado que no existe (llave foránea), un importe que no cabe en
    `numeric(12,2)`— tumbaba la acción con un error en vez de devolver un
    mensaje. Es el mismo que ya tenía el alta. Lo encontró
    `scripts/_probe-acciones-viaticos.ts`.
  */
  let res: Awaited<ReturnType<typeof addExpense>>;
  try {
    const db = await tenantDb();
    res = await db.transaction((tx) =>
      addExpense(
        tx,
        {
          viaticoId: viaticoId.data,
          destino: destino.valor,
          rubroId: rubroId.data,
          // Que el rubro EXIJA la nota lo decide el dominio, leyendo la fila: aquí
          // no se sabe cuál la pide y comprobarlo obligaría a consultar el
          // catálogo desde la acción, que es justo lo que esta capa no hace.
          note: String(formData.get("note") ?? ""),
          description,
          amountMxn: monto,
          spentOn: spentOn.data,
          receiptPath,
        },
        userId,
      ),
    );
  } catch (e) {
    console.error("[viaticos] gasto", e);
    return { ok: false, error: "No se pudo agregar el gasto." };
  }
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
  // Quitar un renglón es COMPROBAR, como ponerlo, y ponerlo ya pedía «editar».
  // Este no lo pedía: con «ver» —o sin nada— se borraban gastos propios. Lo
  // encontró `scripts/_probe-acciones-viaticos.ts`.
  if (!(await puedeEn("viaticos", "editar"))) {
    return { ok: false, error: "No tienes permiso para quitar gastos." };
  }
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
  // Mandar la comprobación es la última parte de COMPROBAR: `viaticos: editar`,
  // igual que cargar los gastos. No se exigía. Lo encontró
  // `scripts/_probe-acciones-viaticos.ts`.
  if (!(await puedeEn("viaticos", "editar"))) {
    return { ok: false, error: "No tienes permiso para mandar la comprobación." };
  }
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
