import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  contractEquipment,
  contracts,
  crmDeals,
  crmOrganizations,
  tickets,
  viaticoDestinos,
  viaticoExpenses,
  viaticoRubros,
  viaticos,
} from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import type { MembershipRole } from "@/lib/db/platform";
import { getSettings } from "@/lib/data/settings";
import { ajustesGuardados, nivelEfectivo, type Nivel } from "@/lib/permisos";
import { nextViaticoReference } from "@/lib/domain/references";
import { crearAvisos } from "@/lib/notificaciones";
import { diasDeViaje, type ViaticoEstado } from "@/lib/viaticos";

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
 * ── A DÓNDE SE VIAJA LO DECIDE LA EMPRESA ──────────────────────────────────
 *
 * Desde la 0037 un viático tiene UNO O VARIOS destinos (`viaticoDestinos`):
 * contratos, VISITAS a clientes sin contrato vigente y prospectos. Qué se puede
 * pedir no está escrito aquí: lo decide cada empresa en `settings`, y aquí se
 * hace cumplir —`vetoDestinos`—, no en la pantalla, porque una regla escrita en
 * la pantalla se salta por cualquier otro camino que escriba en la tabla:
 *
 *   · el ROL de quien pide tiene que estar en la lista de ese tipo de destino
 *     (`viaticosContratosRoles`, `viaticosVisitasRoles`,
 *     `viaticosProspectosRoles`);
 *   · no más destinos DE CADA TIPO que `viaticosMaxPorTipo` —cuántos
 *     contratos, cuántos clientes a visitar y cuántos prospectos—;
 *   · contratos y destinos comerciales juntos, solo con
 *     `viaticosMezclarDestinos`.
 *
 * Va por rol y no por capacidad, al revés que casi todo aquí, porque no decide
 * acceso sino una política de gasto: a qué puestos les paga la empresa cada
 * clase de viaje. Era una condición más —acceso a Ventas por persona— y se
 * quitó en la 0033: dos reglas para una decisión obligaban a entrar en la hoja
 * de permisos de cada vendedor después de encender el interruptor.
 *
 * Y el destino tiene que SER lo que dice: una visita, a un cliente sin contrato
 * vigente; un prospecto, a quien no ha comprado. La clasificación se comprueba
 * con las mismas expresiones que llenan las listas del formulario
 * (`ES_CLIENTE`, `TIENE_CONTRATO_VIGENTE`), para que no se pueda pedir por otro
 * camino lo que la pantalla no ofrece.
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
/** El rol de una persona en esta empresa, o `null` si ya no pertenece. */
async function rolDe(userId: string): Promise<MembershipRole | null> {
  const gente = await listTenantMembers();
  return gente.find((p) => p.id === userId)?.role ?? null;
}

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
      // Las fechas viajan porque el tope de un rubro es presupuesto × DÍAS: sin
      // ellas no se puede saber contra qué se compara.
      departsOn: viaticos.departsOn,
      returnsOn: viaticos.returnsOn,
      estimatedMxn: viaticos.estimatedMxn,
      authorizedMxn: viaticos.authorizedMxn,
    })
    .from(viaticos)
    .where(eq(viaticos.id, id))
    .limit(1);
  if (!v) return null;
  return { ...v, destinos: await destinosDe(tx, id) };
}

/** Los destinos de un viaje, en orden. Ver la 0037. */
async function destinosDe(tx: DbOrTx, viaticoId: string) {
  return tx
    .select({
      id: viaticoDestinos.id,
      tipo: viaticoDestinos.tipo,
      contractId: viaticoDestinos.contractId,
      organizationId: viaticoDestinos.organizationId,
      dealId: viaticoDestinos.dealId,
    })
    .from(viaticoDestinos)
    .where(eq(viaticoDestinos.viaticoId, viaticoId))
    .orderBy(asc(viaticoDestinos.position), asc(viaticoDestinos.createdAt));
}

type DestinoCargado = Awaited<ReturnType<typeof destinosDe>>[number];

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
 * UN DESTINO DEL VIAJE: contrato, visita o prospecto.
 *
 * Unión y no tres campos opcionales sueltos para que el compilador no deje
 * construir el caso imposible —un contrato con negocio, una visita sin
 * empresa—. El CHECK de la 0037 dice lo mismo del otro lado; aquí se dice
 * antes, con un mensaje que se entiende.
 */
export type DestinoViatico =
  | { tipo: "contrato"; contractId: string }
  | { tipo: "visita"; organizationId: string; dealId?: string | null }
  | { tipo: "prospecto"; organizationId: string; dealId?: string | null };

export type TipoDestino = DestinoViatico["tipo"];

export const NOMBRE_DESTINO: Record<TipoDestino, string> = {
  contrato: "contratos",
  visita: "visitas a clientes sin contrato",
  prospecto: "prospectos",
};

export type NuevoViatico = {
  /** A dónde se viaja, en orden. Al menos uno. Ver `vetoDestinos`. */
  destinos: DestinoViatico[];
  requestedById: string;
  /** A quién se le manda a firmar. Obligatorio desde la 0028. */
  approverId: string;
  destination: string;
  purpose: string;
  departsOn: string;
  returnsOn: string;
  estimatedMxn: number;
  /** Módulos de los contratos que se van a atender. Puede ir vacío. */
  moduleIds: string[];
};

/**
 * ¿Puede esta persona pedir ESTOS destinos, según la política de su empresa?
 *
 * Devuelve el motivo cuando NO puede, `null` cuando sí —la forma que ya usa
 * `firmaValida()`: quien llama solo pregunta si hay veto—. Cada mensaje dice
 * dónde se cambia la regla, porque quien choca con ella casi nunca es quien la
 * puede cambiar, y tiene que poder decirle a quién ir.
 *
 * El orden importa: primero lo que es de la POLÍTICA (cuántos, cuáles, quién),
 * y solo después se va a la base a comprobar que cada destino sea lo que dice.
 * Así una regla apagada se explica como regla, no como «ese cliente no existe».
 */
async function vetoDestinos(
  tx: DbOrTx,
  requestedById: string,
  destinos: DestinoViatico[],
): Promise<string | null> {
  if (destinos.length === 0) return "Elige al menos un destino.";

  const politica = await getSettings(tx);
  const DONDE = "Se configura en Configuración → Viáticos.";

  /*
    Un tope POR TIPO y no uno para todo: una empresa puede querer giras de tres
    prospectos y un solo contrato por viaje. El mensaje dice el tope del tipo
    que se pasó, que es lo único que le sirve a quien lo lee.
  */
  for (const tipo of ["contrato", "visita", "prospecto"] as const) {
    const n = destinos.filter((d) => d.tipo === tipo).length;
    const tope = politica.viaticosMaxPorTipo[tipo];
    if (n > tope) {
      const cuantos = {
        contrato: tope === 1 ? "un solo contrato" : `hasta ${tope} contratos`,
        visita: tope === 1 ? "una sola visita a cliente" : `hasta ${tope} visitas a clientes`,
        prospecto: tope === 1 ? "un solo prospecto" : `hasta ${tope} prospectos`,
      }[tipo];
      return `Esta empresa permite ${cuantos} por viático. ${DONDE}`;
    }
  }

  const contratos = destinos.filter((d) => d.tipo === "contrato").map((d) => d.contractId);
  const empresas = destinos
    .filter((d): d is Exclude<DestinoViatico, { tipo: "contrato" }> => d.tipo !== "contrato")
    .map((d) => d.organizationId);
  if (new Set(contratos).size !== contratos.length || new Set(empresas).size !== empresas.length) {
    return "Hay un destino repetido. Cada contrato o empresa va una sola vez por viaje.";
  }

  if (contratos.length > 0 && empresas.length > 0 && !politica.viaticosMezclarDestinos) {
    return `Esta empresa pide por separado los viajes de servicio (contratos) y los comerciales (visitas y prospectos). ${DONDE}`;
  }

  const rol = await rolDe(requestedById);
  if (!rol) return "Ya no perteneces a esta empresa.";
  const roles: Record<TipoDestino, MembershipRole[]> = {
    contrato: politica.viaticosContratosRoles,
    visita: politica.viaticosVisitasRoles,
    prospecto: politica.viaticosProspectosRoles,
  };
  for (const tipo of new Set(destinos.map((d) => d.tipo))) {
    if (roles[tipo].length === 0) {
      return `Esta empresa no tiene habilitados los viajes a ${NOMBRE_DESTINO[tipo]}. ${DONDE}`;
    }
    if (!roles[tipo].includes(rol)) {
      return `Tu rol no puede pedir viajes a ${NOMBRE_DESTINO[tipo]}. Quien administre viáticos decide qué roles pueden, en Configuración → Viáticos.`;
    }
  }

  return vetoClasificacion(tx, destinos);
}

/**
 * ¿Cada destino ES lo que dice ser?
 *
 * Un contrato que existe; una visita a un CLIENTE sin contrato vigente; un
 * prospecto que no ha comprado; y el negocio, abierto y de esa empresa. Con las
 * mismas expresiones que llenan las listas del formulario (ver la cabecera):
 * sin esto, un uuid cambiado a mano pediría como «visita» —comercial, sin
 * utilidad que la mida— el viaje a un cliente con contrato.
 */
async function vetoClasificacion(
  tx: DbOrTx,
  destinos: DestinoViatico[],
): Promise<string | null> {
  const { ES_CLIENTE, TIENE_CONTRATO_VIGENTE } = await import("@/lib/data/crm");

  const contratos = destinos.flatMap((d) => (d.tipo === "contrato" ? [d.contractId] : []));
  if (contratos.length) {
    const hay = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(inArray(contracts.id, contratos));
    if (hay.length !== new Set(contratos).size) return "Uno de los contratos ya no existe.";
  }

  const empresas = destinos.flatMap((d) => (d.tipo === "contrato" ? [] : [d]));
  if (empresas.length) {
    const filas = await tx
      .select({
        id: crmOrganizations.id,
        name: crmOrganizations.name,
        cliente: ES_CLIENTE,
        vigente: TIENE_CONTRATO_VIGENTE,
      })
      .from(crmOrganizations)
      .where(inArray(crmOrganizations.id, empresas.map((d) => d.organizationId)));
    const porId = new Map(filas.map((f) => [f.id, f]));

    for (const d of empresas) {
      const o = porId.get(d.organizationId);
      if (!o) return "Una de las empresas del viaje ya no existe.";
      if (d.tipo === "visita") {
        if (!o.cliente) return `«${o.name}» todavía no es cliente: su viaje se pide como prospecto.`;
        if (o.vigente) {
          return `«${o.name}» tiene contrato vigente: el viaje va por su contrato, para que el gasto entre en su utilidad.`;
        }
      }
      if (d.tipo === "prospecto" && o.cliente) {
        return `«${o.name}» ya es cliente: su viaje se pide como visita (o por su contrato, si tiene uno vigente).`;
      }
    }

    const negocios = empresas.flatMap((d) => (d.dealId ? [{ dealId: d.dealId, org: d.organizationId }] : []));
    if (negocios.length) {
      const deals = await tx
        .select({ id: crmDeals.id, org: crmDeals.organizationId, status: crmDeals.status })
        .from(crmDeals)
        .where(inArray(crmDeals.id, negocios.map((n) => n.dealId)));
      for (const n of negocios) {
        const d = deals.find((x) => x.id === n.dealId);
        if (!d || d.org !== n.org) return "Uno de los negocios no es de la empresa a la que se viaja.";
        if (d.status !== "open") return "Solo se cuelga el viaje de un negocio abierto.";
      }
    }
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

  const veto = await vetoDestinos(tx, input.requestedById, input.destinos);
  if (veto) return { ok: false, reason: veto };

  const reference = await nextViaticoReference(tx);
  const [fila] = await tx
    .insert(viaticos)
    .values({
      reference,
      requestedById: input.requestedById,
      approverId: input.approverId,
      destination: input.destination,
      purpose: input.purpose,
      departsOn: input.departsOn,
      returnsOn: input.returnsOn,
      estimatedMxn: input.estimatedMxn.toFixed(2),
    })
    .returning({ id: viaticos.id });

  await tx.insert(viaticoDestinos).values(
    input.destinos.map((d, position) => ({
      viaticoId: fila.id,
      tipo: d.tipo,
      contractId: d.tipo === "contrato" ? d.contractId : null,
      organizationId: d.tipo === "contrato" ? null : d.organizationId,
      dealId: d.tipo === "contrato" ? null : (d.dealId ?? null),
      position,
    })),
  );

  // Los módulos son del equipo instalado, y solo un contrato lo tiene. No es
  // una restricción que haya que explicar: el formulario ni siquiera enseña el
  // selector cuando no hay ningún destino de contrato.
  if (input.destinos.some((d) => d.tipo === "contrato")) {
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
  /**
   * Ni ticket ni negocio. Con `destinoId`, es gasto de esa visita o de ese
   * prospecto; sin él, en un viaje de varios destinos, es GASTO GENERAL del
   * viaje (el hotel que sirvió para los tres). En un viaje de un solo destino
   * no hace falta decirlo: es de ése. Ver `resolverDestino`.
   */
  | { tipo: "comercial"; destinoId?: string | null };

export type NuevoGasto = {
  viaticoId: string;
  destino: DestinoGasto;
  /** Fila de `viatico_rubros`. Ya no es un enum del código: ver la 0029. */
  rubroId: string;
  note?: string | null;
  description: string;
  amountMxn: number;
  spentOn: string;
  receiptPath?: string | null;
};

/**
 * ¿Existe el rubro, está vivo, y trae la nota que pide?
 *
 * ── ESTA COMPROBACIÓN REEMPLAZA A UN CHECK DE LA BASE ──────────────────────
 *
 * La 0026 exigía por CHECK que la categoría `otros` llevara etiqueta, y su
 * comentario decía —con razón— que una validación que vive solo en la pantalla
 * se salta desde cualquier otro camino. Desde la 0029 la regla es «los rubros
 * marcados `requiresNote` exigen nota», y eso depende de otra tabla: un CHECK
 * no puede leerla.
 *
 * Así que vive aquí, que es la capa por la que pasa todo lo que escribe —igual
 * que `firmaValida()`— y no en la acción ni en el formulario. Lo que se perdió
 * es real: un `insert` a mano puede dejar la nota vacía. Está dicho en la
 * migración para que nadie lo descubra por su cuenta.
 *
 * Se rechaza un rubro INACTIVO porque desactivarlo es decir «no se use más»; si
 * se aceptara, la única diferencia con estar activo sería que no sale en el
 * desplegable, y el catálogo dejaría de significar algo.
 */
async function vetoRubro(
  tx: DbOrTx,
  rubroId: string,
  note: string | null | undefined,
): Promise<string | null> {
  const [r] = await tx
    .select({
      name: viaticoRubros.name,
      active: viaticoRubros.active,
      requiresNote: viaticoRubros.requiresNote,
    })
    .from(viaticoRubros)
    .where(eq(viaticoRubros.id, rubroId))
    .limit(1);

  if (!r) return "Ese rubro de gasto no existe.";
  if (!r.active) return `El rubro «${r.name}» está retirado. Elige otro.`;
  if (r.requiresNote && !note?.trim()) {
    return `En «${r.name}» hay que especificar de qué se trata.`;
  }
  return null;
}

/**
 * ¿A QUÉ DESTINO DEL VIAJE VA ESTE GASTO, Y CABE AHÍ?
 *
 * Devuelve las tres columnas ya resueltas, o el motivo por el que no cabe.
 *
 * El destino se DEDUCE cuando se puede, en vez de pedírselo a quien captura:
 * un ticket es de un equipo, y el equipo lo ampara uno de los contratos del
 * viaje; un negocio es de una empresa, y la empresa es una de las visitas o
 * prospectos del viaje. Solo el gasto «comercial» —ni ticket ni negocio—
 * necesita que alguien diga de qué destino es.
 *
 *   · un destino DE CONTRATO carga a tickets, como desde el primer día: su
 *     gasto tiene dónde caer —el servicio que se fue a atender— y dejarlo
 *     suelto lo sacaría de la utilidad del contrato justo cuando sí es suyo;
 *   · una visita o un prospecto no tienen tickets: van a un negocio suyo o al
 *     destino a secas;
 *   · el gasto GENERAL (sin destino) solo cabe con varios destinos. Con uno,
 *     el general ES de ese destino y se asigna solo: así un viaje de un destino
 *     cuesta exactamente lo mismo que antes de la 0037.
 *
 * El ticket tiene que ser DE UN CONTRATO DEL VIAJE (lo encontró
 * `_probe-acciones-viaticos`: se aceptaba cualquier ticket de la empresa, y un
 * uuid cambiado a mano cargaba el gasto a otro contrato), y el negocio, DE UNA
 * EMPRESA DEL VIAJE.
 */
type DestinoResuelto = { destinoId: string | null; ticketId: string | null; dealId: string | null };

async function resolverDestino(
  tx: DbOrTx,
  destinos: DestinoCargado[],
  destino: DestinoGasto,
): Promise<{ ok: true; columnas: DestinoResuelto } | { ok: false; reason: string }> {
  if (destinos.length === 0) {
    // Solo pasaría con una fila escrita a mano: el alta exige al menos uno.
    return { ok: false, reason: "Este viático no tiene destinos." };
  }

  if (destino.tipo === "ticket") {
    const deContrato = destinos.filter((d) => d.tipo === "contrato" && d.contractId);
    if (deContrato.length === 0) {
      return {
        ok: false,
        reason: "Este viaje no va a ningún contrato, y los tickets son de un contrato. Cárgalo al negocio o a la visita.",
      };
    }
    const [t] = await tx
      .select({ contractId: contractEquipment.contractId })
      .from(tickets)
      .innerJoin(contractEquipment, eq(contractEquipment.equipmentId, tickets.equipmentId))
      .where(
        and(
          eq(tickets.id, destino.ticketId),
          inArray(contractEquipment.contractId, deContrato.map((d) => d.contractId!)),
        ),
      )
      .limit(1);
    const d = t && deContrato.find((x) => x.contractId === t.contractId);
    if (!d) return { ok: false, reason: "Ese ticket no es de un equipo de los contratos de este viaje." };
    return { ok: true, columnas: { destinoId: d.id, ticketId: destino.ticketId, dealId: null } };
  }

  if (destino.tipo === "negocio") {
    const [n] = await tx
      .select({ org: crmDeals.organizationId })
      .from(crmDeals)
      .where(eq(crmDeals.id, destino.dealId))
      .limit(1);
    const d = n && destinos.find((x) => x.tipo !== "contrato" && x.organizationId === n.org);
    if (!d) return { ok: false, reason: "Ese negocio no es de ninguna de las empresas de este viaje." };
    return { ok: true, columnas: { destinoId: d.id, ticketId: null, dealId: destino.dealId } };
  }

  // Comercial: ni ticket ni negocio.
  if (destino.destinoId) {
    const d = destinos.find((x) => x.id === destino.destinoId);
    if (!d) return { ok: false, reason: "Ese destino no es de este viaje." };
    if (d.tipo === "contrato") {
      return { ok: false, reason: "El gasto de un contrato va a un ticket del servicio." };
    }
    return { ok: true, columnas: { destinoId: d.id, ticketId: null, dealId: null } };
  }

  if (destinos.length === 1) {
    const [unico] = destinos;
    if (unico.tipo === "contrato") {
      return { ok: false, reason: "Este viático es de un contrato: cada gasto va a un ticket del servicio." };
    }
    return { ok: true, columnas: { destinoId: unico.id, ticketId: null, dealId: null } };
  }

  // Varios destinos y ninguno nombrado: gasto general del viaje.
  return { ok: true, columnas: { destinoId: null, ticketId: null, dealId: null } };
}

/**
 * ¿ESTE GASTO SE PASA DEL PRESUPUESTO, Y ESTA EMPRESA LO IMPIDE?
 *
 * Lo decide CADA RUBRO, no la empresa (0031): el hotel se cotiza antes de
 * viajar y su tope es un tope; la comida depende de dónde se pare uno y su tope
 * es una guía. Apagado —lo de fábrica— pasarse sigue permitido y sale marcado
 * en la comprobación.
 *
 * ── LA CUENTA ES LA MISMA QUE LA DEL AVISO, A PROPÓSITO ────────────────────
 *
 * Suma del rubro en TODO el viaje —lo ya capturado más este gasto— contra
 * presupuesto × días. No el gasto suelto contra el tope diario: una factura de
 * hotel por tres noches se rechazaría siendo correcta.
 *
 * Que las dos medidas coincidan es lo que impide el peor de los casos: una
 * pantalla que enseña el gasto en verde y un servidor que lo rechaza, sin que
 * nadie pueda decir cuál de los dos tiene razón. Por eso `consumoPorRubro` vive
 * en `lib/viaticos.ts`, sin `server-only`, y lo usan los dos lados.
 *
 * Un rubro SIN tope no bloquea nunca: nulo es «no lo hemos definido».
 */
async function vetoPresupuesto(
  tx: DbOrTx,
  v: { id: string; departsOn: string; returnsOn: string },
  gasto: { rubroId: string; amountMxn: number },
): Promise<string | null> {
  const [r] = await tx
    .select({
      name: viaticoRubros.name,
      dailyBudgetMxn: viaticoRubros.dailyBudgetMxn,
      blocksOverBudget: viaticoRubros.blocksOverBudget,
    })
    .from(viaticoRubros)
    .where(eq(viaticoRubros.id, gasto.rubroId))
    .limit(1);

  // Sin bandera no se bloquea, y sin tope tampoco: un rubro sin presupuesto no
  // tiene contra qué comparar, esté encendido o no.
  if (!r?.blocksOverBudget || !r.dailyBudgetMxn) return null;

  const [ya] = await tx
    .select({ n: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8` })
    .from(viaticoExpenses)
    .where(
      and(
        eq(viaticoExpenses.viaticoId, v.id),
        eq(viaticoExpenses.rubroId, gasto.rubroId),
      ),
    );

  const dias = diasDeViaje(v.departsOn, v.returnsOn);
  const tope = Number(r.dailyBudgetMxn) * Math.max(1, dias);
  const total = Number(ya?.n ?? 0) + gasto.amountMxn;
  if (total <= tope) return null;

  // El mensaje dice el tope, lo ya gastado y cuánto sobra: sin eso, quien
  // captura solo sabe que no puede, y la salida que encuentra es cambiar el
  // rubro — que es justo lo que arruina el análisis.
  return (
    `«${r.name}» tiene un tope de ${tope.toFixed(2)} para este viaje ` +
    `(${Number(r.dailyBudgetMxn).toFixed(2)} × ${dias} día(s)). ` +
    `Llevas ${Number(ya?.n ?? 0).toFixed(2)} y esto lo dejaría en ${total.toFixed(2)}. ` +
    `Pídele a quien autoriza que amplíe el presupuesto o que lo revise.`
  );
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

  const vetoDelRubro = await vetoRubro(tx, gasto.rubroId, gasto.note);
  if (vetoDelRubro) return { ok: false, reason: vetoDelRubro };

  const vetoDelTope = await vetoPresupuesto(tx, v, gasto);
  if (vetoDelTope) return { ok: false, reason: vetoDelTope };

  const destino = await resolverDestino(tx, v.destinos, gasto.destino);
  if (!destino.ok) return { ok: false, reason: destino.reason };

  const [fila] = await tx
    .insert(viaticoExpenses)
    .values({
      viaticoId: gasto.viaticoId,
      ...destino.columnas,
      rubroId: gasto.rubroId,
      // La nota se guarda si la hay, la pida el rubro o no: alguien que aclara
      // «cena con el cliente» en un gasto de Comida está dando información que
      // no hay motivo para tirar.
      note: gasto.note?.trim() || null,
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

  const destino = await resolverDestino(tx, v.destinos, args.destino);
  if (!destino.ok) return { ok: false, reason: destino.reason };

  await tx
    .update(viaticoExpenses)
    .set({
      ...destino.columnas,
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
