import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { crmDeals, viaticoExpenses, viaticos } from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import { getSettings } from "@/lib/data/settings";
import { ajustesGuardados, alcanza, nivelEfectivo, type Nivel } from "@/lib/permisos";
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
 * ── Y DESDE LA 0028, FIRMA UNA PERSONA CON NOMBRE ──────────────────────────
 *
 * Quien pide elige a quién se lo manda, y solo esa persona firma. Antes se le
 * anunciaba a todo el que pudiera administrar viáticos y lo resolvía el primero
 * que lo viera: con dos personas funciona, con seis cada una supone que lo
 * mirará otra y el documento se queda quieto una semana.
 *
 * `approverId` nulo significa el comportamiento viejo —cualquiera que administre
 * firma—, y existe para que las filas anteriores a la 0028 sigan su curso. Los
 * viáticos NUEVOS lo exigen, y lo exige esta capa porque la base no puede:
 * comprobar que el elegido pueda administrar viáticos obliga a leer
 * `memberships`, que está en otro esquema.
 *
 * ── EL VIAJE A QUIEN TODAVÍA NO ES CLIENTE ─────────────────────────────────
 *
 * Un viático es de un CONTRATO o de un PROSPECTO, nunca de los dos ni de
 * ninguno. Lo de prospecto pide dos condiciones que se comprueban aquí y no en
 * la pantalla, porque una regla escrita en la pantalla se salta por cualquier
 * otro camino que escriba en la tabla:
 *
 *   · que la EMPRESA lo permita (`settings.viaticosProspectos`), que es una
 *     política de gasto y no una función del programa;
 *   · que QUIEN PIDE tenga acceso a Ventas, aunque sea de solo lectura. No hace
 *     falta un permiso nuevo: si alguien no puede ni ver la cartera de
 *     prospectos, tampoco tiene por qué poder mandarse de viaje a uno.
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
  return (await aprobadoresPosibles(exceptoId)).map((a) => a.id);
}

/**
 * Los mismos, CON NOMBRE, para poder elegir a uno.
 *
 * Desde la 0028 la lista no solo reparte avisos: es el desplegable donde quien
 * pide elige a quién le manda el viático. Que salga de la misma función que los
 * avisos es lo que impide el caso absurdo —elegir a alguien que después no
 * puede firmar—, porque la pregunta que contestan las dos es la misma.
 */
export async function aprobadoresPosibles(
  exceptoId?: string,
): Promise<Array<{ id: string; name: string | null; role: string }>> {
  const gente = await listTenantMembers();
  return gente
    .filter(
      (m) =>
        m.id !== exceptoId &&
        nivelEfectivo(m.role, ajustesGuardados(m.permissions), "viaticos") ===
          "administrar",
    )
    .map((m) => ({ id: m.id, name: m.name, role: m.role }));
}

/**
 * El nivel efectivo de una persona en un módulo, o `null` si no es de la casa.
 *
 * Se resuelve contra `listTenantMembers()`, que ya excluye a quien está dado de
 * baja —en la empresa o en la plataforma—. Que las bajas no aparezcan es parte
 * de la respuesta y no un efecto secundario: nombrar aprobador a quien ya no
 * trabaja aquí deja el viático esperando una firma que no va a llegar.
 */
async function nivelDe(userId: string, modulo: "viaticos" | "ventas"): Promise<Nivel | null> {
  const gente = await listTenantMembers();
  const m = gente.find((p) => p.id === userId);
  if (!m) return null;
  return nivelEfectivo(m.role, ajustesGuardados(m.permissions), modulo);
}

/**
 * ¿Puede esta persona firmar ESTE viático?
 *
 * Tres condiciones ahora, y las dos últimas son las que importan: hay que poder
 * administrar viáticos, no haber sido quien lo pidió, y —si el viático nombra
 * aprobador— ser esa persona. Ver la cabecera.
 *
 * El tercer filtro NO es un permiso, es un destinatario: quien administra
 * viáticos sigue pudiendo administrarlos todos, pero para firmar uno que le
 * mandaron a otro tiene que reasignárselo primero. Así queda escrito que se lo
 * quitó a alguien, en vez de aparecer su firma en un documento que nunca fue
 * suyo.
 */
function firmaValida(
  v: { requestedById: string; approverId: string | null },
  actorId: string,
  puedeAdministrar: boolean,
): string | null {
  if (!puedeAdministrar) return "No tienes permiso para autorizar viáticos.";
  if (v.requestedById === actorId) {
    return "No puedes firmar un viático que pediste tú. Tiene que revisarlo otra persona.";
  }
  if (v.approverId && v.approverId !== actorId) {
    return "Este viático está a nombre de otra persona para firmar. Reasignalo si tiene que resolverlo alguien más.";
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
      approverId: viaticos.approverId,
      contractId: viaticos.contractId,
      organizationId: viaticos.organizationId,
      dealId: viaticos.dealId,
      estimatedMxn: viaticos.estimatedMxn,
      authorizedMxn: viaticos.authorizedMxn,
    })
    .from(viaticos)
    .where(eq(viaticos.id, id))
    .limit(1);
  return v ?? null;
}

/**
 * A QUIÉN LE TOCA MOVER ESTE VIÁTICO.
 *
 * Con aprobador nombrado, a él y a nadie más. Sin él —las filas anteriores a la
 * 0028—, a todos los que puedan administrar, que es como funcionaba antes.
 *
 * Existe para que las dos transiciones que piden firma —enviar y comprobar—
 * repartan el aviso igual. Cuando cada una calculaba su lista por su cuenta era
 * cuestión de tiempo que una se quedara con la regla vieja.
 */
async function destinatariosDeFirma(v: {
  approverId: string | null;
  requestedById: string;
}): Promise<string[]> {
  if (v.approverId) return [v.approverId];
  return quienesAutorizan(v.requestedById);
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

/**
 * EL ASUNTO: contrato o prospecto, nunca los dos.
 *
 * Se modela como unión y no como tres campos opcionales sueltos porque así el
 * compilador no deja construir el caso imposible. El CHECK de la base dice lo
 * mismo del otro lado; aquí se dice antes, con un mensaje que se entiende.
 */
export type AsuntoViatico =
  | { tipo: "contrato"; contractId: string }
  | { tipo: "prospecto"; organizationId: string; dealId?: string | null };

export type NuevoViatico = {
  asunto: AsuntoViatico;
  requestedById: string;
  /** A quién se le manda a firmar. Obligatorio desde la 0028. */
  approverId: string;
  destination: string;
  purpose: string;
  departsOn: string;
  returnsOn: string;
  estimatedMxn: number;
  /** Módulos del contrato que se van a atender. Puede ir vacío. */
  moduleIds: string[];
};

/**
 * ¿Puede esta persona pedir un viaje a un prospecto?
 *
 * Dos condiciones, y ninguna es un permiso nuevo: que la empresa lo permita y
 * que quien pide tenga acceso a Ventas aunque sea de solo lectura. Ver la
 * cabecera del archivo.
 *
 * Devuelve el motivo cuando NO puede, `null` cuando sí. Es la forma que ya usa
 * `firmaValida()`: quien llama solo tiene que preguntar si hay veto.
 */
async function vetoProspecto(tx: DbOrTx, requestedById: string): Promise<string | null> {
  const ajustes = await getSettings(tx);
  if (!ajustes.viaticosProspectos) {
    return "Esta empresa no tiene habilitados los viáticos a prospectos. Se enciende en Configuración.";
  }
  const nivel = await nivelDe(requestedById, "ventas");
  if (!nivel || !alcanza(nivel, "ver")) {
    return "Para pedir un viaje a un prospecto hace falta acceso a Ventas. Pídelo en tu hoja de permisos.";
  }
  return null;
}

/**
 * ¿Es válido mandarle este viático a firmar a esta persona?
 *
 * Se comprueba AL CREAR y al reasignar, no al firmar: descubrir en el momento
 * de la firma que el elegido nunca pudo firmar deja el documento parado y a dos
 * personas esperándose. Aquí el error sale mientras el formulario sigue abierto.
 */
async function vetoAprobador(
  approverId: string,
  requestedById: string,
): Promise<string | null> {
  if (approverId === requestedById) {
    return "No puedes mandarte a firmar tu propio viático. Elige a otra persona.";
  }
  const nivel = await nivelDe(approverId, "viaticos");
  if (!nivel) {
    return "Esa persona ya no está activa en la empresa. Elige a otra.";
  }
  if (nivel !== "administrar") {
    return "Esa persona no puede autorizar viáticos. Elige a alguien de Administración o General.";
  }
  return null;
}

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

  const vetoFirma = await vetoAprobador(input.approverId, input.requestedById);
  if (vetoFirma) return { ok: false, reason: vetoFirma };

  if (input.asunto.tipo === "prospecto") {
    const veto = await vetoProspecto(tx, input.requestedById);
    if (veto) return { ok: false, reason: veto };
  }

  const reference = await nextViaticoReference(tx);
  const [fila] = await tx
    .insert(viaticos)
    .values({
      reference,
      contractId: input.asunto.tipo === "contrato" ? input.asunto.contractId : null,
      organizationId:
        input.asunto.tipo === "prospecto" ? input.asunto.organizationId : null,
      dealId: input.asunto.tipo === "prospecto" ? (input.asunto.dealId ?? null) : null,
      requestedById: input.requestedById,
      approverId: input.approverId,
      destination: input.destination,
      purpose: input.purpose,
      departsOn: input.departsOn,
      returnsOn: input.returnsOn,
      estimatedMxn: input.estimatedMxn.toFixed(2),
    })
    .returning({ id: viaticos.id });

  // Los módulos son del equipo instalado, y un prospecto no tiene equipo
  // instalado. No es una restricción que haya que explicar: el formulario ni
  // siquiera enseña el selector cuando el asunto es un prospecto.
  if (input.asunto.tipo === "contrato") {
    await guardarModulos(tx, fila.id, input.moduleIds);
  }
  return { ok: true, id: fila.id };
}

/**
 * CAMBIAR A QUIÉN LE TOCA FIRMAR.
 *
 * Un aprobador único es un punto de bloqueo en cuanto se va de vacaciones, y
 * esta es la salida — la única, porque `firmaValida()` no deja que otro firme
 * por su cuenta. Que haya que reasignar explícitamente es el punto: queda
 * escrito que alguien se lo quitó a alguien.
 *
 * Lo hace quien administra viáticos. No hace falta ser el aprobador actual: el
 * caso que esto resuelve es justamente que el aprobador actual no está.
 */
export async function reassignViatico(
  tx: DbOrTx,
  args: {
    id: string;
    actorId: string;
    puedeAdministrar: boolean;
    approverId: string;
  },
): Promise<Resultado> {
  const v = await cargar(tx, args.id);
  if (!v) return { ok: false, reason: "El viático no existe." };
  if (!args.puedeAdministrar) {
    return { ok: false, reason: "No tienes permiso para reasignar viáticos." };
  }
  if (v.status !== "enviado" && v.status !== "autorizado" && v.status !== "en_revision") {
    return {
      ok: false,
      reason: `No hay nada que reasignar: está en «${v.status}».`,
    };
  }
  if (v.approverId === args.approverId) {
    return { ok: false, reason: "Ya está a nombre de esa persona." };
  }

  const veto = await vetoAprobador(args.approverId, v.requestedById);
  if (veto) return { ok: false, reason: veto };

  await tx
    .update(viaticos)
    .set({ approverId: args.approverId, updatedAt: new Date() })
    .where(eq(viaticos.id, args.id));

  // Le llega al NUEVO firmante, que es quien tiene trabajo que hacer. Al
  // anterior no: quitarle algo de la bandeja no le pide nada.
  await crearAvisos({
    paraUsuarios: [args.approverId],
    viaticoId: args.id,
    tipo: "viatico.reasignado",
    titulo: `Viático ${v.reference} pasó a tu firma`,
    cuerpo: "Te reasignaron una solicitud de viáticos.",
  });

  return { ok: true, id: args.id };
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
    paraUsuarios: await destinatariosDeFirma(v),
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
    paraUsuarios: await destinatariosDeFirma(v),
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

/**
 * LOS TRES DESTINOS DE UN GASTO.
 *
 *   ticket    → entra en la utilidad de ese servicio (lo de siempre)
 *   negocio   → es costo de esa oportunidad
 *   comercial → gasto del viaje y de nadie más
 *
 * Unión y no tres campos opcionales, por lo mismo que el asunto de la cabecera:
 * «ticket y negocio a la vez» no es un caso que haya que rechazar en tiempo de
 * ejecución, es un caso que no se puede escribir.
 */
export type DestinoGasto =
  | { tipo: "ticket"; ticketId: string }
  | { tipo: "negocio"; dealId: string }
  | { tipo: "comercial" };

export type NuevoGasto = {
  viaticoId: string;
  destino: DestinoGasto;
  category: "hotel" | "transporte" | "comida" | "refacciones" | "otros";
  otherLabel?: string | null;
  description: string;
  amountMxn: number;
  spentOn: string;
  receiptPath?: string | null;
};

/**
 * ¿Cabe este destino en este viático?
 *
 * El asunto de la cabecera decide qué destinos existen abajo, y no al revés:
 *
 *   · un viático DE CONTRATO carga a tickets, como desde el primer día. El
 *     gasto comercial suelto no se le permite porque tiene dónde caer —el
 *     servicio que se fue a atender— y dejarlo suelto sería sacarlo de la
 *     utilidad del contrato justo cuando sí pertenece a ella;
 *   · un viático DE PROSPECTO no puede cargar a un ticket. No hay servicio.
 *
 * Y si se nombra un negocio, tiene que ser DE ESE PROSPECTO. Sin esta
 * comprobación, un uuid cambiado a mano carga la cena de una empresa a la
 * oportunidad de otra, y el informe comercial lo daría por bueno.
 */
async function destinoValido(
  tx: DbOrTx,
  v: { contractId: string | null; organizationId: string | null },
  destino: DestinoGasto,
): Promise<string | null> {
  if (v.contractId) {
    return destino.tipo === "ticket"
      ? null
      : "Este viático es de un contrato: cada gasto va a un ticket del servicio.";
  }

  if (destino.tipo === "ticket") {
    return "Este viaje es a un prospecto, y un prospecto no tiene tickets. Cárgalo al negocio o déjalo como gasto comercial.";
  }
  if (destino.tipo === "comercial") return null;

  const [d] = await tx
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(
      and(eq(crmDeals.id, destino.dealId), eq(crmDeals.organizationId, v.organizationId!)),
    )
    .limit(1);
  return d ? null : "Ese negocio no es de la empresa a la que se viajó.";
}

/** El destino, tal como se guarda en las dos columnas. */
function columnasDeDestino(destino: DestinoGasto) {
  return {
    ticketId: destino.tipo === "ticket" ? destino.ticketId : null,
    dealId: destino.tipo === "negocio" ? destino.dealId : null,
  };
}

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

  const vetoDestino = await destinoValido(tx, v, gasto.destino);
  if (vetoDestino) return { ok: false, reason: vetoDestino };

  const [fila] = await tx
    .insert(viaticoExpenses)
    .values({
      viaticoId: gasto.viaticoId,
      ...columnasDeDestino(gasto.destino),
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

/**
 * QUIEN FIRMA DECIDE DÓNDE CAE EL GASTO.
 *
 * El ingeniero carga la cena con el destino que le parece —normalmente el que
 * el formulario trae puesto— y quien revisa la mueve: esta comida sí era de la
 * oportunidad, aquel taxi no era de nadie. Es la única forma de que la
 * clasificación se decida donde alguien tiene contexto para decidirla.
 *
 * ── SOLO EN `en_revision`, Y ESO ES TODO EL DISEÑO ─────────────────────────
 *
 * Antes no: mientras el ingeniero sigue capturando, moverle un renglón es
 * discutir con alguien que todavía está escribiendo. Después tampoco: cerrado
 * el viático, el costo ya entró en la utilidad de un ticket o de un negocio, y
 * cambiarlo movería un número que alguien ya informó. Si hace falta corregir un
 * viático cerrado, se corrige donde se corrigen los cerrados —devolviéndolo no
 * se puede, y esa es una decisión consciente: el rastro vale más que la comodidad—.
 *
 * No cambia el importe ni la categoría. Reclasificar es decir de quién es el
 * gasto, no cuánto fue: si lo segundo está mal, se devuelve la comprobación.
 */
export async function reclassifyExpense(
  tx: DbOrTx,
  args: {
    expenseId: string;
    actorId: string;
    puedeAdministrar: boolean;
    destino: DestinoGasto;
  },
): Promise<Resultado> {
  const [g] = await tx
    .select({ id: viaticoExpenses.id, viaticoId: viaticoExpenses.viaticoId })
    .from(viaticoExpenses)
    .where(eq(viaticoExpenses.id, args.expenseId))
    .limit(1);
  if (!g) return { ok: false, reason: "El gasto no existe." };

  const v = await cargar(tx, g.viaticoId);
  if (!v) return { ok: false, reason: "El viático no existe." };

  const veto = firmaValida(v, args.actorId, args.puedeAdministrar);
  if (veto) return { ok: false, reason: veto };
  if (v.status !== "en_revision") {
    return {
      ok: false,
      reason:
        v.status === "cerrado"
          ? "El viático ya está cerrado: el gasto entró en la utilidad y no se mueve."
          : "Solo se reclasifica mientras la comprobación está en revisión.",
    };
  }

  const vetoDestino = await destinoValido(tx, v, args.destino);
  if (vetoDestino) return { ok: false, reason: vetoDestino };

  await tx
    .update(viaticoExpenses)
    .set({
      ...columnasDeDestino(args.destino),
      reclassifiedById: args.actorId,
      reclassifiedAt: new Date(),
    })
    .where(eq(viaticoExpenses.id, args.expenseId));

  return { ok: true, id: args.expenseId };
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
