/**
 * LAS ACCIONES DE VIÁTICOS: QUIÉN MUEVE QUÉ, CON QUÉ NIVEL, SOBRE QUÉ VIÁTICO Y
 * A DÓNDE.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-viaticos.ts
 *
 * Doce acciones sobre un documento que pasa de mano en mano: quien viaja PIDE,
 * ENVÍA, CARGA sus gastos y los MANDA a revisar; el aprobador nombrado
 * AUTORIZA, RECHAZA, RECLASIFICA, DEVUELVE y CIERRA. Lo que aporta la capa de
 * acción —y lo único que se prueba aquí— es el pegamento entre la sesión y el
 * dominio:
 *
 *   · que el actor que llega al dominio sea el de la SESIÓN y no un campo del
 *     formulario —un `requestedById` o un `actorId` inyectados no cuelan—;
 *   · que cada transición pida su nivel de módulo exacto (`editar` para lo de
 *     quien viaja, `administrar` para lo de quien firma) y, con un escalón
 *     menos, diga que no SIN escribir;
 *   · que la separación de funciones se sostenga llamando a la acción con DOS
 *     personas distintas: quien pide no firma aunque administre, otro
 *     administrador no firma lo que está a nombre de otro, y el aprobador no
 *     carga ni quita gastos en un viático que no es suyo.
 *
 * Las restricciones de la base, el tope por rubro y la regla de la nota ya las
 * cubre `probe-viaticos.mts` contra el dominio; no se repiten.
 *
 * ── Y DESDE LA 0037, A DÓNDE SE VIAJA LO DECIDE LA EMPRESA ─────────────────
 *
 * Un viático tiene uno o VARIOS destinos —contratos, visitas a clientes sin
 * contrato vigente y prospectos—, y qué se puede pedir lo dice `settings`. Esa
 * política no es de la acción sino del dominio (`vetoDestinos`), pero solo se
 * puede ejercitar de verdad por aquí: necesita el ROL real de quien pide, que
 * vive en `memberships` y que el dominio lee con `listTenantMembers()`. Así que
 * este probe prueba CADA PERILLA EN SUS DOS ESTADOS —el skill
 * `decisiones-configurables` lo pide y es la razón de que existan: una regla
 * configurable probada solo encendida es media prueba—, la clasificación de
 * cada destino, a qué destino cae cada gasto, cómo se reparte el costo y lo
 * que leen las pantallas.
 *
 * La fila `settings` de la empresa se guarda al empezar y se REPONE al final:
 * otros probes corren contra la misma base y esperan los valores de fábrica.
 *
 * ── LAS PERSONAS Y LOS CLIENTES SE CREAN, NO SE BUSCAN ─────────────────────
 *
 * El dominio no se fía del stub para decidir quién puede firmar: `vetoAprobador`
 * lee el nivel REAL del elegido en `memberships`. La base sembrada solo trae
 * agentes, vendedores y clientes —nadie administra viáticos—, así que las tres
 * personas de la prueba se dan de alta aquí con el rol General y se borran al
 * final. Llevan compras, pagar y servicio en «ninguno» a propósito: así no
 * entran en las listas de aprobadores ni en la cola de servicio de los probes
 * que corren a la vez contra la misma base, y no les cambian los avisos.
 *
 * Las empresas que se visitan también se fabrican —cliente con contrato
 * vigente, con contrato VENCIDO, por negocio ganado, prospectos—: la siembra no
 * trae negocios, y lo que se prueba es justo la frontera entre esas clases, que
 * no puede depender de lo que el padrón traiga hoy. Solo los contratos con
 * tickets se toman de la siembra, y solo se leen.
 *
 * El nivel que pide cada ACCIÓN se sigue simulando con `como(…)`: es la
 * pregunta de módulo que la acción le hace a `puedeEn`, y es la que hay que
 * poder contestar con un escalón menos.
 */
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
  como,
  conError,
  cuantos,
  filas,
  foto,
  forma,
  intentar,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
} from "./_acciones-kit";

const MARCA = marca("VIA");
const SLUG = ESQUEMA.replace(/^tenant_/, "");
/** Un uuid bien formado que no es de nada: pasa Zod y tiene que fallar después. */
const FANTASMA = "00000000-0000-4000-8000-00000000dead";

/* ── Lo que se mira antes y después de cada acción ─────────────────────── */

/*
  Todas las transiciones ACTUALIZAN, así que la foto lleva la fila entera —con
  `updated_at`, que cualquier `update` mueve— y no un conteo. Y lleva también los
  gastos y los avisos del viático: una transición rechazada que aun así avisara
  al aprobador sería media escritura.
*/
const FILA = (id: string) =>
  `select status, requested_by_id, approver_id, approved_by_id, authorized_mxn, approval_note,
          submitted_at, reported_at, closed_by_id, closing_note, resolution_reason, updated_at
     from ${ESQUEMA}.viaticos where id = '${id}'`;
// Con `destino_id` desde la 0037: reclasificar puede mover SOLO eso.
const GASTOS = (viaticoId: string) =>
  `select id, destino_id, ticket_id, deal_id, rubro_id, amount_mxn, note, reclassified_by_id, reclassified_at
     from ${ESQUEMA}.viatico_expenses where viatico_id = '${viaticoId}' order by id`;
const AVISOS = (viaticoId: string) =>
  `select user_id, kind from ${ESQUEMA}.notifications where viatico_id = '${viaticoId}'
    order by user_id, kind`;
const TODO = (id: string) => [FILA(id), GASTOS(id), AVISOS(id)];
/** Las altas de esta corrida, por la marca que llevan en el destino. */
const ALTAS = `select count(*)::int as n from ${ESQUEMA}.viaticos where destination like '${MARCA}%'`;
/** Y sus destinos: un alta rechazada no puede dejar filas en `viatico_destinos`. */
const DESTINOS_DE_ALTAS = `select count(*)::int as n
    from ${ESQUEMA}.viatico_destinos d join ${ESQUEMA}.viaticos v on v.id = d.viatico_id
   where v.destination like '${MARCA}%'`;
const ALTA_Y_DESTINOS = [ALTAS, DESTINOS_DE_ALTAS];

/** Las siete perillas de la política de destinos (0033, 0037): tres listas, tres topes y mezclar. */
const COLUMNAS_POLITICA =
  "viaticos_contratos_roles, viaticos_visitas_roles, viaticos_prospectos_roles, " +
  "viaticos_max_contratos, viaticos_max_visitas, viaticos_max_prospectos, viaticos_mezclar_destinos";
const AJUSTES = (esquema: string) =>
  `select ${COLUMNAS_POLITICA} from ${esquema}.settings where id = 'global'`;

type Fila = {
  status: string;
  requested_by_id: string;
  approver_id: string | null;
  approved_by_id: string | null;
  authorized_mxn: string | null;
  approval_note: string | null;
  submitted_at: Date | null;
  reported_at: Date | null;
  closed_by_id: string | null;
  closing_note: string | null;
  resolution_reason: string | null;
};
type Gasto = {
  id: string;
  destino_id: string | null;
  ticket_id: string | null;
  deal_id: string | null;
  rubro_id: string;
  amount_mxn: string;
  note: string | null;
  receipt_path?: string | null;
  reclassified_by_id: string | null;
  reclassified_at: Date | null;
};
type Ajustes = {
  viaticos_contratos_roles: string[];
  viaticos_visitas_roles: string[];
  viaticos_prospectos_roles: string[];
  viaticos_max_contratos: number;
  viaticos_max_visitas: number;
  viaticos_max_prospectos: number;
  viaticos_mezclar_destinos: boolean;
};
type DestinoFila = {
  id: string;
  tipo: string;
  contract_id: string | null;
  organization_id: string | null;
  deal_id: string | null;
  position: number;
};

async function fila(id: string): Promise<Fila | undefined> {
  return (await filas<Fila>(FILA(id)))[0];
}
async function avisoPara(viaticoId: string, userId: string, kind: string): Promise<boolean> {
  const n = await cuantos(
    "notifications",
    `where viatico_id = '${viaticoId}' and user_id = '${userId}' and kind = '${kind}'`,
  );
  return n === 1;
}
/** Los destinos de un viático, en orden, como los dejó la base. */
async function destinosDe(viaticoId: string): Promise<DestinoFila[]> {
  return filas<DestinoFila>(
    `select id::text as id, tipo::text as tipo, contract_id::text as contract_id,
            organization_id::text as organization_id, deal_id::text as deal_id, position
       from ${ESQUEMA}.viatico_destinos where viatico_id = '${viaticoId}'
      order by position, created_at`,
  );
}
/** Un gasto de esta corrida, por su descripción. */
async function gastoPor(descripcion: string): Promise<Gasto | undefined> {
  return (
    await filas<Gasto>(
      `select id::text as id, destino_id::text as destino_id, ticket_id::text as ticket_id,
              deal_id::text as deal_id, rubro_id::text as rubro_id, amount_mxn, note,
              reclassified_by_id::text as reclassified_by_id, reclassified_at
         from ${ESQUEMA}.viatico_expenses where description = '${MARCA} ${descripcion}'`,
    )
  )[0];
}

type Estado = { ok: boolean; error?: string; message?: string; viaticoId?: string };

/**
 * Corre una acción del camino feliz sin dejar que un lanzamiento tumbe el
 * probe: lo que no vuelva como `{ ok }` se convierte en un error legible, y las
 * comprobaciones de después siguen corriendo.
 */
async function llamar(fn: () => Promise<Estado>): Promise<Estado> {
  const r = await intentar(fn);
  if (r.valor) return r.valor;
  return { ok: false, error: r.error ? `reventó: ${r.error}` : `redirigió a ${r.redirige}` };
}

/* ── Los mensajes de la política, escritos una vez ─────────────────────── */

const DONDE = "Se configura en Configuración → Viáticos.";
const NOMBRE: Record<string, string> = {
  contrato: "contratos",
  visita: "visitas a clientes sin contrato",
  prospecto: "prospectos",
};
/** La lista de roles de ese tipo está vacía: la empresa lo tiene apagado. */
const APAGADO = (tipo: string) => `Esta empresa no tiene habilitados los viajes a ${NOMBRE[tipo]}. ${DONDE}`;
/** Encendido, pero no para el rol de quien pide. */
const NO_TU_ROL = (tipo: string) =>
  `Tu rol no puede pedir viajes a ${NOMBRE[tipo]}. Quien administre viáticos decide qué roles pueden, en Configuración → Viáticos.`;
/** Un tipo pasó su tope. El mensaje nombra el tipo y su tope, no «destinos» a secas. */
const TOPE = (tipo: "contrato" | "visita" | "prospecto", n: number) => {
  const cuantos = {
    contrato: n === 1 ? "un solo contrato" : `hasta ${n} contratos`,
    visita: n === 1 ? "una sola visita a cliente" : `hasta ${n} visitas a clientes`,
    prospecto: n === 1 ? "un solo prospecto" : `hasta ${n} prospectos`,
  }[tipo];
  return `Esta empresa permite ${cuantos} por viático. ${DONDE}`;
};
const SIN_MEZCLA = `Esta empresa pide por separado los viajes de servicio (contratos) y los comerciales (visitas y prospectos). ${DONDE}`;
const REPETIDO = "Hay un destino repetido. Cada contrato o empresa va una sola vez por viaje.";
const ROLES_INTERNOS = ["owner", "admin", "agent", "sales", "general"];

void probar("viáticos: guardia, nivel, separación de funciones, política de destinos y lo que se escribe", async () => {
  /* ── 0 · el escenario ────────────────────────────────────────────────── */

  const [tenant] = await filas<{ id: string }>(
    `select id::text as id from public.tenants where slug = '${SLUG}'`,
  );
  if (!tenant) throw new Error(`la base no trae la empresa ${SLUG}`);

  /*
    Un contrato que atienda equipos con tickets, dos tickets suyos y uno que NO
    es de ese contrato. Se buscan en la siembra —no se crean— porque solo se
    LEEN: el viático cuelga de ellos y se borra al final; ellos no se tocan.

    Desde la 0037 hace falta un SEGUNDO contrato con un ticket propio —uno cuyo
    equipo no ampare también el primero—, para comprobar que en una gira a dos
    contratos el ticket encuentra SU destino; y el ticket ajeno tiene que serlo
    de los dos.
  */
  const [base] = await filas<{ c: string }>(
    `select ce.contract_id::text as c
       from ${ESQUEMA}.contract_equipment ce
       join ${ESQUEMA}.tickets t on t.equipment_id = ce.equipment_id
      group by ce.contract_id having count(distinct t.id) >= 2
      order by ce.contract_id limit 1`,
  );
  if (!base) throw new Error("la base no trae un contrato con dos tickets");
  const C = base.c;
  const tks = await filas<{ id: string }>(
    `select distinct t.id::text as id
       from ${ESQUEMA}.contract_equipment ce
       join ${ESQUEMA}.tickets t on t.equipment_id = ce.equipment_id
      where ce.contract_id = '${C}' order by 1 limit 2`,
  );
  const [T1, T2] = tks.map((t) => t.id);
  const [otro] = await filas<{ c: string; t: string }>(
    `select ce.contract_id::text as c, t.id::text as t
       from ${ESQUEMA}.contract_equipment ce
       join ${ESQUEMA}.tickets t on t.equipment_id = ce.equipment_id
      where ce.contract_id <> '${C}'
        and not exists (select 1 from ${ESQUEMA}.contract_equipment x
                         where x.contract_id = '${C}' and x.equipment_id = t.equipment_id)
      order by 1, 2 limit 1`,
  );
  const C2 = otro?.c;
  const T3 = otro?.t;
  if (!T1 || !T2 || !C2 || !T3) throw new Error("la base no trae dos contratos con tickets propios");
  const [tx] = await filas<{ id: string }>(
    `select t.id::text as id from ${ESQUEMA}.tickets t
      where not exists (select 1 from ${ESQUEMA}.contract_equipment ce
                         where ce.contract_id in ('${C}', '${C2}') and ce.equipment_id = t.equipment_id)
      order by t.id limit 1`,
  );
  const TX = tx?.id;
  /*
    Y dos contratos más, cualesquiera —solo se nombran en un alta, no se les
    carga nada—, para llegar a cuatro: el tope por tipo se prueba con su borde
    (3 con tope 3) y uno más (4 con tope 3).
  */
  const [C3, C4] = (
    await filas<{ id: string }>(
      `select id::text as id from ${ESQUEMA}.contracts
        where id not in ('${C}', '${C2}') order by id limit 2`,
    )
  ).map((f) => f.id);
  const numeros = new Map(
    (
      await filas<{ id: string; number: string }>(
        `select id::text as id, number from ${ESQUEMA}.contracts where id in ('${C}', '${C2}')`,
      )
    ).map((f) => [f.id, f.number]),
  );
  const rubro = async (clave: string) =>
    (
      await filas<{ id: string }>(
        `select id::text as id from ${ESQUEMA}.viatico_rubros where key = '${clave}' and active`,
      )
    )[0]?.id;
  const HOTEL = await rubro("hotel");
  const OTROS = await rubro("otros");
  if (!TX || !C3 || !C4 || !HOTEL || !OTROS) {
    throw new Error("faltan un ticket ajeno a los dos contratos, cuatro contratos o los rubros de fábrica (hotel, otros)");
  }
  /*
    La política de la empresa AJENA, antes de tocar nada: el probe cambia la de
    la sesión una docena de veces, y ninguna tiene derecho a mover esta.
  */
  const ajenoAntes = await foto(AJUSTES(AJENO));

  /*
    LA POLÍTICA SE REPONE COMO ESTABA, Y SOLO ELLA.

    Es la misma disciplina que `_probe-acciones-viaticos-config`: `settings` es
    UNA fila que comparten el tipo de cambio y las tarifas, así que no se borra
    a ciegas. Si existía, se le devuelven sus cinco columnas de viáticos. Si no
    existía, se borra solo si nadie más la tocó —todo lo demás en sus valores
    de fábrica—; si alguien la tocó, las cinco vuelven a su DEFAULT, que es
    exactamente lo que significa no tener fila.
  */
  const [original] = await filas<Ajustes>(AJUSTES(ESQUEMA));

  /*
    El orden de las limpiezas importa y va AL REVÉS de como se registran: lo
    primero que se borra son los viáticos (que se llevan en cascada destinos,
    gastos y avisos), después los contratos, negocios y empresas fabricados
    —`viatico_destinos` los tiene en `restrict`— y al final las personas.
  */
  const creadas: string[] = [];
  alLimpiar(async () => {
    if (creadas.length === 0) return;
    await sql.unsafe(`delete from public.users where id = any($1::uuid[])`, [creadas]);
  });
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.crm_organizations where name like '${MARCA}%'`));
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.contracts where number like '${MARCA}%'`));
  // El embudo se lleva en cascada sus etapas y sus negocios.
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.crm_pipelines where name like '${MARCA}%'`));
  alLimpiar(async () => {
    if (creadas.length === 0) return;
    // Los destinos, los gastos y los avisos se van en cascada con su viático.
    await sql.unsafe(
      `delete from ${ESQUEMA}.viaticos where requested_by_id = any($1::uuid[])`,
      [creadas],
    );
  });
  alLimpiar(async () => {
    if (original) {
      return sql.unsafe(
        `update ${ESQUEMA}.settings
            set viaticos_contratos_roles = $1::jsonb, viaticos_visitas_roles = $2::jsonb,
                viaticos_prospectos_roles = $3::jsonb, viaticos_max_contratos = $4,
                viaticos_max_visitas = $5, viaticos_max_prospectos = $6,
                viaticos_mezclar_destinos = $7
          where id = 'global'`,
        [
          JSON.stringify(original.viaticos_contratos_roles),
          JSON.stringify(original.viaticos_visitas_roles),
          JSON.stringify(original.viaticos_prospectos_roles),
          original.viaticos_max_contratos,
          original.viaticos_max_visitas,
          original.viaticos_max_prospectos,
          original.viaticos_mezclar_destinos,
        ],
      );
    }
    await sql.unsafe(
      `delete from ${ESQUEMA}.settings
        where id = 'global' and usd_rate is null and labor_cost_per_hour is null
          and labor_rate_per_hour is null and tipo_cambio_automatico`,
    );
    return sql.unsafe(
      `update ${ESQUEMA}.settings
          set viaticos_contratos_roles = default, viaticos_visitas_roles = default,
              viaticos_prospectos_roles = default, viaticos_max_contratos = default,
              viaticos_max_visitas = default, viaticos_max_prospectos = default,
              viaticos_mezclar_destinos = default
        where id = 'global'`,
    );
  });

  /**
   * Fija la política. Lo que no se diga queda en su valor de fábrica —los
   * topes que no se nombren, en 1—, así cada llamada describe el estado entero
   * y no depende de la anterior. `"fabrica"` pone el DEFAULT de cada columna,
   * que es lo que dejó la migración.
   */
  type Topes = { contrato?: number; visita?: number; prospecto?: number };
  async function politica(
    p:
      | "fabrica"
      | { contratos?: string[]; visitas?: string[]; prospectos?: string[]; topes?: Topes; mezclar?: boolean },
  ): Promise<void> {
    if (p === "fabrica") {
      await sql.unsafe(
        `insert into ${ESQUEMA}.settings (id) values ('global')
         on conflict (id) do update
           set viaticos_contratos_roles = default, viaticos_visitas_roles = default,
               viaticos_prospectos_roles = default, viaticos_max_contratos = default,
               viaticos_max_visitas = default, viaticos_max_prospectos = default,
               viaticos_mezclar_destinos = default`,
      );
      return;
    }
    await sql.unsafe(
      `insert into ${ESQUEMA}.settings
         (id, viaticos_contratos_roles, viaticos_visitas_roles, viaticos_prospectos_roles,
          viaticos_max_contratos, viaticos_max_visitas, viaticos_max_prospectos, viaticos_mezclar_destinos)
       values ('global', $1::jsonb, $2::jsonb, $3::jsonb, $4, $5, $6, $7)
       on conflict (id) do update
         set viaticos_contratos_roles = excluded.viaticos_contratos_roles,
             viaticos_visitas_roles = excluded.viaticos_visitas_roles,
             viaticos_prospectos_roles = excluded.viaticos_prospectos_roles,
             viaticos_max_contratos = excluded.viaticos_max_contratos,
             viaticos_max_visitas = excluded.viaticos_max_visitas,
             viaticos_max_prospectos = excluded.viaticos_max_prospectos,
             viaticos_mezclar_destinos = excluded.viaticos_mezclar_destinos`,
      [
        JSON.stringify(p.contratos ?? ROLES_INTERNOS),
        JSON.stringify(p.visitas ?? []),
        JSON.stringify(p.prospectos ?? []),
        p.topes?.contrato ?? 1,
        p.topes?.visita ?? 1,
        p.topes?.prospecto ?? 1,
        p.mezclar ?? false,
      ],
    );
  }

  const SOLO_VIATICOS = JSON.stringify({ compras: "ninguno", pagar: "ninguno", servicio: "ninguno" });
  /** Una persona de la casa (con membresía) o, con `rol` nulo, un usuario suelto. */
  async function persona(papel: string, rol: string | null = "general"): Promise<string> {
    const [u] = await filas<{ id: string }>(
      `insert into public.users (name, email)
       values ('${MARCA} ${papel}', '${MARCA.toLowerCase()}-${papel}@probe.invalid')
       returning id::text as id`,
    );
    creadas.push(u.id);
    if (rol) {
      await sql.unsafe(
        `insert into public.memberships (user_id, tenant_id, role, permissions)
         values ($1, $2, $3, $4::jsonb)`,
        [u.id, tenant.id, rol, SOLO_VIATICOS],
      );
    }
    return u.id;
  }
  /*
    S pide y viaja. Es General a propósito: «el administrador que también viaja»
    es el caso que la cabecera del dominio dice que hay que sostener, y con un
    agente la regla se cumpliría por falta de permiso y no por la regla.
    A es el aprobador nombrado. O administra viáticos, pero no le toca firmar.
  */
  const S = await persona("solicitante");
  const A = await persona("aprobador");
  const O = await persona("otro-admin");

  /*
    LAS EMPRESAS A LAS QUE SE VIAJA, cada una en una clase distinta.

    Los contratos van a nombre de dos cuentas de cliente fabricadas —el
    contrato exige `client_id`—, sin membresía: no entran al portal interno.

      OV  cliente (cuenta enlazada) con contrato VIGENTE     → no se visita
      ON  cliente por un contrato que salió de SU negocio    → no se visita
          (el segundo camino de `TIENE_CONTRATO_VIGENTE`)
      OX  cliente con contrato VENCIDO                        → SÍ se visita
      OG  cliente por negocio ganado, sin contrato            → SÍ se visita
      P1  prospecto, con un negocio abierto y uno perdido
      P2  prospecto, con un negocio abierto
      OG2, OG3, P3, P4   más de lo mismo, para llegar a cuatro de cada tipo
  */
  const CU1 = await persona("cuenta-cliente-1", null);
  const CU2 = await persona("cuenta-cliente-2", null);
  const [{ id: embudo }] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${MARCA} embudo') returning id::text as id`,
  );
  const [{ id: etapa }] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name) values ('${embudo}', '${MARCA} etapa')
     returning id::text as id`,
  );
  const nombres = new Map<string, string>();
  async function empresa(clave: string, cuenta: string | null = null): Promise<string> {
    const nombre = `${MARCA} ${clave}`;
    const [o] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_organizations (name, client_id)
       values ('${nombre}', ${cuenta ? `'${cuenta}'` : "null"}) returning id::text as id`,
    );
    nombres.set(o.id, nombre);
    return o.id;
  }
  const titulos = new Map<string, string>();
  async function negocio(clave: string, org: string, estado: "open" | "won" | "lost"): Promise<string> {
    const [d] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id, organization_id, status)
       values ('${MARCA}-${clave}', '${MARCA} negocio ${clave}', '${embudo}', '${etapa}', '${org}', '${estado}')
       returning id::text as id`,
    );
    titulos.set(d.id, `${MARCA} negocio ${clave}`);
    return d.id;
  }
  async function contrato(clave: string, cuenta: string, fin: string, deal: string | null = null) {
    await sql.unsafe(
      `insert into ${ESQUEMA}.contracts (number, client_id, deal_id, end_date)
       values ('${MARCA}-${clave}', '${cuenta}', ${deal ? `'${deal}'` : "null"}, ${fin})`,
    );
  }

  const OV = await empresa("Cliente vigente", CU1);
  await contrato("K1", CU1, "current_date + 30");
  const ON = await empresa("Cliente por negocio");
  const DWN = await negocio("DWN", ON, "won");
  // A nombre de CU1: la cuenta de ON no existe, y así su contrato solo se le
  // reconoce por el negocio.
  await contrato("K3", CU1, "null", DWN);
  const OX = await empresa("Cliente vencido", CU2);
  await contrato("K2", CU2, "current_date - 30");
  const DOX = await negocio("DOX", OX, "open");
  const OG = await empresa("Cliente ganado");
  await negocio("DWG", OG, "won");
  const DOG = await negocio("DOG", OG, "open");
  const P1 = await empresa("Prospecto uno");
  const DP1 = await negocio("DP1", P1, "open");
  const DP1L = await negocio("DP1L", P1, "lost");
  const P2 = await empresa("Prospecto dos");
  const DP2 = await negocio("DP2", P2, "open");
  const OG2 = await empresa("Cliente ganado dos");
  await negocio("DWG2", OG2, "won");
  const OG3 = await empresa("Cliente ganado tres");
  await negocio("DWG3", OG3, "won");
  const P3 = await empresa("Prospecto tres");
  const P4 = await empresa("Prospecto cuatro");

  const destinoDe = new Map<string, string>();
  let n = 0;
  /** Un viático sembrado a mano en el estado que haga falta, de S, a nombre de A y al contrato C. */
  async function viatico(estado: string): Promise<string> {
    n++;
    const autorizado = ["autorizado", "en_revision", "cerrado"].includes(estado) ? "5000" : "null";
    const [v] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.viaticos
         (reference, requested_by_id, approver_id, destination, purpose,
          departs_on, returns_on, estimated_mxn, authorized_mxn, status)
       values ('${MARCA}-${n}', '${S}', '${A}', '${MARCA} sembrado ${n}', 'probe',
               '2026-10-01', '2026-10-03', 5000, ${autorizado}, '${estado}')
       returning id::text as id`,
    );
    const [d] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.viatico_destinos (viatico_id, tipo, contract_id)
       values ('${v.id}', 'contrato', '${C}') returning id::text as id`,
    );
    destinoDe.set(v.id, d.id);
    return v.id;
  }
  async function gastoSembrado(viaticoId: string): Promise<string> {
    const [g] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.viatico_expenses
         (viatico_id, destino_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
       values ('${viaticoId}', '${destinoDe.get(viaticoId)}', '${T1}', '${HOTEL}', '${MARCA} sembrado', 100, '2026-10-02')
       returning id::text as id`,
    );
    return g.id;
  }

  const v = await import("@/lib/actions/viaticos");
  const ini = { ok: false };

  /**
   * Las tres puertas de toda acción con guardia de módulo: sin sesión, con
   * sesión y todo denegado, y con UN escalón menos del que pide. Las tres
   * comparan el mensaje de la guardia: si la guardia deja pasar, lo que vuelve
   * es otro error —el del dominio— y se ve.
   */
  async function guardia(
    nombre: string,
    actor: string,
    menor: string,
    mensaje: string,
    fn: () => Promise<unknown>,
    que: string[],
  ): Promise<void> {
    como(null);
    await rechazaSinEscribir(`${nombre}, sin sesión`, fn, que, conError("No hay sesión."));
    como(actor, false);
    await rechazaSinEscribir(`${nombre}, sin permiso`, fn, que, conError(mensaje));
    como(actor, menor);
    await rechazaSinEscribir(`${nombre}, con «${menor}»`, fn, que, conError(mensaje));
  }

  /* ── El alta con la LISTA de destinos, la forma de la 0037 ─────────────── */

  const ALTA_BASE = {
    approverId: A,
    destination: `${MARCA} Monterrey`,
    purpose: "Visita de la gira",
    departsOn: "2026-10-01",
    returnsOn: "2026-10-03",
    estimatedMxn: "9000",
  };
  type D =
    | { tipo: "contrato"; contractId: string }
    | { tipo: "visita" | "prospecto"; organizationId: string; dealId?: string | null };
  const con = (contractId: string): D => ({ tipo: "contrato", contractId });
  const vis = (organizationId: string, dealId?: string): D => ({ tipo: "visita", organizationId, dealId });
  const pro = (organizationId: string, dealId?: string): D => ({ tipo: "prospecto", organizationId, dealId });
  const crearCon = (destinos: unknown, extra: Record<string, string> = {}) => () =>
    v.crearViaticoAction(
      ini,
      forma({
        ...ALTA_BASE,
        destinos: typeof destinos === "string" ? destinos : JSON.stringify(destinos),
        ...extra,
      }),
    );
  /** Debe rechazarse con ESE mensaje y sin dejar ni cabecera ni destinos. */
  const noEntra = (etiqueta: string, destinos: unknown, mensaje: string) =>
    rechazaSinEscribir(etiqueta, crearCon(destinos), ALTA_Y_DESTINOS, conError(mensaje));
  /**
   * Debe entrar, y sus destinos quedar EXACTAMENTE como se pidieron: mismo
   * tipo, mismas llaves, en el mismo orden. Devuelve el id y los destinos.
   */
  async function entra(etiqueta: string, destinos: D[]): Promise<{ id: string; d: DestinoFila[] }> {
    const r = await llamar(crearCon(destinos));
    ok(`${etiqueta}: entra`, r.ok === true && Boolean(r.viaticoId), r.error);
    const id = r.viaticoId ?? FANTASMA;
    const d = await destinosDe(id);
    const esperado = destinos.map((x, position) => ({
      tipo: x.tipo,
      contract_id: x.tipo === "contrato" ? x.contractId : null,
      organization_id: x.tipo === "contrato" ? null : x.organizationId,
      deal_id: x.tipo === "contrato" ? null : (x.dealId ?? null),
      position,
    }));
    const guardado = d.map((x) => ({
      tipo: x.tipo,
      contract_id: x.contract_id,
      organization_id: x.organization_id,
      deal_id: x.deal_id,
      position: x.position,
    }));
    ok(
      `${etiqueta}: con sus destinos, en orden`,
      JSON.stringify(guardado) === JSON.stringify(esperado),
      JSON.stringify(guardado) === JSON.stringify(esperado) ? "" : JSON.stringify(guardado),
    );
    return { id, d };
  }

  /* ── 1 · la política de fábrica ──────────────────────────────────────── */
  seccion("de fábrica: solo contratos, uno por viático, y nada comercial");

  como(S, "viaticos:editar");
  /*
    DOS FORMAS DE «NO HABER DECIDIDO NADA», y tienen que dar lo mismo: sin fila
    de ajustes —manda `DEFAULTS` en `data/settings.ts`— y con la fila recién
    creada —mandan los DEFAULT de la migración—. Si discreparan, una empresa
    nueva y una recién migrada vivirían políticas distintas sin que nadie lo
    hubiera decidido (ver el skill `decisiones-configurables`, §4). La primera
    solo se puede probar si la empresa no tenía fila: no se le borra a nadie.
  */
  const { getSettings } = await import("@/lib/data/settings");
  const politicaLeida = async () => {
    const s = await getSettings();
    return JSON.stringify([
      s.viaticosContratosRoles,
      s.viaticosVisitasRoles,
      s.viaticosProspectosRoles,
      s.viaticosMaxPorTipo,
      s.viaticosMezclarDestinos,
    ]);
  };
  const fabrica = async (como_: string) => {
    await entra(`${como_}, un contrato`, [con(C)]);
    await noEntra(`${como_}, una visita`, [vis(OX)], APAGADO("visita"));
    await noEntra(`${como_}, un prospecto`, [pro(P1)], APAGADO("prospecto"));
    await noEntra(`${como_}, dos contratos`, [con(C), con(C2)], TOPE("contrato", 1));
  };

  let sinFila: string | null = null;
  if (!original) {
    sinFila = await politicaLeida();
    await fabrica("sin fila de ajustes");
  } else {
    console.log("· la empresa ya tenía fila de ajustes: el caso «sin fila» no se prueba en esta corrida");
  }
  await politica("fabrica");
  const conDefault = JSON.stringify((await filas<Ajustes>(AJUSTES(ESQUEMA)))[0]);
  const deFabrica = JSON.stringify({
    viaticos_contratos_roles: ROLES_INTERNOS,
    viaticos_visitas_roles: [],
    viaticos_prospectos_roles: [],
    viaticos_max_contratos: 1,
    viaticos_max_visitas: 1,
    viaticos_max_prospectos: 1,
    viaticos_mezclar_destinos: false,
  });
  ok(
    "los DEFAULT de la migración: contratos para todos los roles internos, lo demás apagado, un destino de cada tipo, sin mezclar",
    conDefault === deFabrica,
    conDefault === deFabrica ? "" : conDefault,
  );
  if (sinFila !== null) {
    const conFila = await politicaLeida();
    ok("y `DEFAULTS` (sin fila) dice exactamente lo mismo", sinFila === conFila, sinFila === conFila ? "" : `${sinFila} ≠ ${conFila}`);
  }
  await fabrica("con los DEFAULT de la migración");

  /* ── 2 · crear, con la forma de antes de la 0037 ─────────────────────── */
  seccion("crear: pide «editar», y el solicitante es quien tiene la sesión");

  const ALTA = {
    asunto: "contrato",
    contractId: C,
    approverId: A,
    destination: `${MARCA} Monterrey`,
    purpose: "Mantenimiento preventivo",
    departsOn: "2026-10-01",
    returnsOn: "2026-10-03",
    estimatedMxn: "$5,250.50",
  };
  const crear = (campos: Record<string, string>) => () =>
    v.crearViaticoAction(ini, forma({ ...ALTA, ...campos }));

  await guardia("crear", S, "viaticos:ver", "No tienes permiso para pedir viáticos.", crear({}), ALTA_Y_DESTINOS);
  // La guardia vale igual para la forma nueva: la lista no abre otra puerta.
  como(S, "viaticos:ver");
  await rechazaSinEscribir(
    "crear con la lista de destinos, con «viaticos:ver»",
    crearCon([con(C)]),
    ALTA_Y_DESTINOS,
    conError("No tienes permiso para pedir viáticos."),
  );

  como(S, "viaticos:editar");
  const invalidas: Array<[string, Record<string, string>, string | null]> = [
    ["contrato que no es uuid", { contractId: "no-soy-un-uuid" }, "Elige un contrato."],
    // La forma vieja también sabe de visitas y prospectos: los enlaces viejos la mandan.
    ["visita sin cliente", { asunto: "visita", contractId: "" }, "Elige al cliente que se visita."],
    ["prospecto sin empresa", { asunto: "prospecto", contractId: "" }, "Elige un prospecto."],
    ["sin aprobador", { approverId: "" }, "Elige a quién le mandas el viático a firmar."],
    ["destino en blanco", { destination: "   " }, "Falta el destino."],
    ["salida con otro formato", { departsOn: "01/10/2026" }, "Falta la fecha de salida."],
    /*
      Bien formada y aun así imposible. Llegaba a Postgres y volvía como «No se
      pudo crear el viático.»: no escribía, pero por el `catch` y no por la
      validación. Ahora la para Zod, y el mensaje lo dice.
    */
    [
      "salida el 30 de febrero",
      { departsOn: "2026-02-30", returnsOn: "2026-03-02" },
      "Falta la fecha de salida.",
    ],
    [
      "fechas al revés",
      { departsOn: "2026-10-05", returnsOn: "2026-10-01" },
      "El regreso no puede ser antes de la salida.",
    ],
    ["estimado que no es número", { estimatedMxn: "abc" }, "Pon un monto estimado mayor que cero."],
    ["estimado negativo", { estimatedMxn: "-500" }, "Pon un monto estimado mayor que cero."],
    ["estimado en cero", { estimatedMxn: "0" }, "Pon un monto estimado mayor que cero."],
    /*
      Quien pide no se elige a sí mismo para firmar. La regla es del dominio,
      pero el aprobador sale del FORMULARIO y el solicitante de la SESIÓN: esto
      comprueba que la acción no confunde los dos.
    */
    [
      "mandarse el viático a sí mismo",
      { approverId: "__S__" },
      "No puedes mandarte a firmar tu propio viático. Elige a otra persona.",
    ],
  ];
  for (const [nombre, campos, mensaje] of invalidas) {
    const c = Object.fromEntries(
      Object.entries(campos).map(([k, x]) => [k, x === "__S__" ? S : x]),
    );
    await rechazaSinEscribir(
      `crear, ${nombre}`,
      crear(c),
      ALTA_Y_DESTINOS,
      mensaje ? conError(mensaje) : undefined,
    );
  }

  /*
    El camino feliz con tres campos inyectados que la acción debe IGNORAR: un
    solicitante que no es la sesión, un estado adelantado y una firma. Si alguno
    llegara a la fila, cualquiera se autorizaría su propio viaje a mano.
  */
  const alta = await llamar(() =>
    v.crearViaticoAction(
      ini,
      forma({ ...ALTA, requestedById: O, status: "autorizado", approvedById: S, moduleIds: "basura" }),
    ),
  );
  ok("crear responde ok y devuelve el id", alta.ok === true && Boolean(alta.viaticoId), alta.error);
  const V1 = alta.viaticoId ?? FANTASMA;
  let f = await fila(V1);
  ok("el solicitante es el de la SESIÓN, no el del formulario", f?.requested_by_id === S);
  ok("a nombre del aprobador elegido", f?.approver_id === A);
  ok("nace en borrador y sin firma", f?.status === "borrador" && f?.approved_by_id === null, f?.status);
  const [monto] = await filas<{ estimated_mxn: string }>(
    `select estimated_mxn from ${ESQUEMA}.viaticos where id = '${V1}'`,
  );
  ok("el estimado, sin símbolo ni comas", monto?.estimated_mxn === "5250.50", monto?.estimated_mxn);
  // Desde la 0037 el contrato no está en la cabecera: es su único destino.
  const dV1 = await destinosDe(V1);
  ok(
    "la forma vieja deja UN destino: el contrato elegido",
    dV1.length === 1 && dV1[0].tipo === "contrato" && dV1[0].contract_id === C && dV1[0].position === 0,
    dV1.length === 1 ? "" : JSON.stringify(dV1),
  );

  /* ── 3 · la lista de destinos: su forma ──────────────────────────────── */
  seccion("la lista de destinos: lo que la acción sanea antes de preguntar");

  await politica({ visitas: ["general"], prospectos: ["general"], topes: { contrato: 3, visita: 3, prospecto: 3 }, mezclar: true });
  await noEntra("lista vacía", [], "Elige al menos un destino.");
  await noEntra("lista que no es JSON", "[{tipo:contrato", "No se entendió la lista de destinos.");
  const FALTA = "Revisa los destinos: a uno le falta el contrato o la empresa.";
  await noEntra("un contrato sin contrato", [{ tipo: "contrato" }], FALTA);
  await noEntra("una visita con empresa que no es uuid", [{ tipo: "visita", organizationId: "x" }], FALTA);
  await noEntra("un tipo de destino que no existe", [{ tipo: "crucero", organizationId: OX }], FALTA);
  await noEntra("una lista que no es lista", { tipo: "contrato", contractId: C }, FALTA);

  /*
    Lo que sobra se TIRA, no se guarda: un destino de contrato con una empresa
    y un negocio colados llegaba al `insert` como contrato limpio porque Zod
    quita las llaves que no son de su forma —y si no las quitara, el CHECK de
    la 0037 lo rechazaría con un error que nadie entiende—. Y un negocio que no
    es uuid cuenta como «sin negocio»: el selector trae la opción vacía.
  */
  {
    const r = await llamar(crearCon([{ tipo: "contrato", contractId: C, organizationId: OX, dealId: DOX }]));
    const d = await destinosDe(r.viaticoId ?? FANTASMA);
    ok(
      "un contrato con empresa y negocio colados se guarda solo como contrato",
      r.ok === true && d.length === 1 && d[0].organization_id === null && d[0].deal_id === null,
      r.error ?? (d.length === 1 && d[0].organization_id === null ? "" : JSON.stringify(d)),
    );
    const r2 = await llamar(crearCon([{ tipo: "visita", organizationId: OX, dealId: "basura" }]));
    const d2 = await destinosDe(r2.viaticoId ?? FANTASMA);
    ok(
      "un negocio que no es uuid cuenta como «sin negocio»",
      r2.ok === true && d2.length === 1 && d2[0].tipo === "visita" && d2[0].deal_id === null,
      r2.error ?? (d2[0]?.deal_id === null ? "" : JSON.stringify(d2)),
    );
    // La forma vieja con una visita: sigue funcionando para los enlaces viejos.
    const r3 = await llamar(crear({ asunto: "visita", contractId: "", organizationId: OX, dealId: DOX }));
    const d3 = await destinosDe(r3.viaticoId ?? FANTASMA);
    ok(
      "la forma vieja con `asunto=visita` deja su visita, con su negocio",
      r3.ok === true && d3.length === 1 && d3[0].tipo === "visita" && d3[0].organization_id === OX &&
        d3[0].deal_id === DOX,
      r3.error ?? (d3[0]?.deal_id === DOX ? "" : JSON.stringify(d3)),
    );
  }

  /* ── 4 · cada perilla, apagada y encendida ───────────────────────────── */
  seccion("la política: cada perilla en sus dos estados");

  // ¿Quién viaja a CONTRATOS? De fábrica todos; se puede quitar a un rol, o a todos.
  await politica({ contratos: [] });
  await noEntra("contratos con la lista vacía", [con(C)], APAGADO("contrato"));
  await politica({ contratos: ["agent"] });
  await noEntra("contratos, sin el rol de quien pide en la lista", [con(C)], NO_TU_ROL("contrato"));
  await politica({ contratos: ["general"] });
  await entra("contratos, con el rol de quien pide en la lista", [con(C)]);

  // ¿Quién VISITA clientes sin contrato? De fábrica nadie.
  await politica({ visitas: [] });
  await noEntra("visitas con la lista vacía", [vis(OX)], APAGADO("visita"));
  await politica({ visitas: ["agent", "sales"] });
  await noEntra("visitas, sin el rol de quien pide en la lista", [vis(OX)], NO_TU_ROL("visita"));
  await politica({ visitas: ["general"] });
  await entra("visita a un cliente con contrato VENCIDO", [vis(OX)]);
  await entra("visita a un cliente con su negocio abierto", [vis(OX, DOX)]);
  await entra("visita a un cliente por negocio ganado, sin contrato", [vis(OG)]);

  // ¿Quién viaja a PROSPECTOS? De fábrica nadie (0033).
  await politica({ prospectos: [] });
  await noEntra("prospectos con la lista vacía", [pro(P1)], APAGADO("prospecto"));
  await politica({ prospectos: ["agent"] });
  await noEntra("prospectos, sin el rol de quien pide en la lista", [pro(P1)], NO_TU_ROL("prospecto"));
  await politica({ prospectos: ["general"] });
  await entra("prospecto con su negocio abierto", [pro(P1, DP1)]);

  // El rol se mira por TIPO: tener uno encendido no abre el otro.
  await politica({ visitas: ["general"], prospectos: ["agent"] });
  await noEntra("gira visita + prospecto con solo las visitas para mi rol", [vis(OX), pro(P1)], NO_TU_ROL("prospecto"));

  /*
    ¿CUÁNTOS DE CADA TIPO? De fábrica uno de cada uno. Un tope por TIPO, y en
    cada uno: pasarse de 1, caber con 3, el borde (3 con 3) y uno más (4 con 3).
  */
  const COMERCIAL = { visitas: ["general"], prospectos: ["general"] };
  const TIPOS: Array<["contrato" | "visita" | "prospecto", string, (i: number) => D]> = [
    ["contrato", "contratos", (i) => con([C, C2, C3, C4][i])],
    ["visita", "visitas", (i) => vis([OX, OG, OG2, OG3][i])],
    ["prospecto", "prospectos", (i) => pro([P1, P2, P3, P4][i])],
  ];
  const varios = (f: (i: number) => D, n: number) => Array.from({ length: n }, (_, i) => f(i));
  for (const [tipo, plural, uno] of TIPOS) {
    await politica({ ...COMERCIAL, topes: { [tipo]: 1 } });
    await noEntra(`2 ${plural} con su tope en 1`, varios(uno, 2), TOPE(tipo, 1));
    await politica({ ...COMERCIAL, topes: { [tipo]: 3 } });
    await entra(`2 ${plural} con su tope en 3`, varios(uno, 2));
    await entra(`3 ${plural} con su tope en 3 (el borde)`, varios(uno, 3));
    await noEntra(`4 ${plural} con su tope en 3`, varios(uno, 4), TOPE(tipo, 3));
  }

  /*
    Y SON INDEPENDIENTES: el tope de uno no presta ni quita cupo al otro. Con
    tres prospectos y una visita, caben 3 + 1; una visita más se rechaza con el
    mensaje de VISITAS —no con uno de «demasiados destinos»—. Y al revés.
  */
  await politica({ ...COMERCIAL, topes: { prospecto: 3, visita: 1 } });
  await entra("3 prospectos + 1 visita, con 3 prospectos y 1 visita de tope", [pro(P1), pro(P2), pro(P3), vis(OX)]);
  await noEntra(
    "3 prospectos + 2 visitas, con 3 prospectos y 1 visita de tope",
    [pro(P1), pro(P2), pro(P3), vis(OX), vis(OG)],
    TOPE("visita", 1),
  );
  await politica({ ...COMERCIAL, topes: { visita: 3, prospecto: 1 } });
  await entra("3 visitas + 1 prospecto, con 3 visitas y 1 prospecto de tope", [vis(OX), vis(OG), vis(OG2), pro(P1)]);
  await noEntra(
    "3 visitas + 2 prospectos, con 3 visitas y 1 prospecto de tope",
    [vis(OX), vis(OG), vis(OG2), pro(P1), pro(P2)],
    TOPE("prospecto", 1),
  );

  /*
    ¿SE MEZCLAN CONTRATOS CON LO COMERCIAL? De fábrica no. Con todos los topes
    en 1 —un contrato y una visita caben por tope—, lo único que decide es
    esta perilla.
  */
  await politica({ ...COMERCIAL, mezclar: false });
  await noEntra("contrato + visita sin mezclar (topes en 1)", [con(C), vis(OX)], SIN_MEZCLA);
  await noEntra("contrato + prospecto sin mezclar (topes en 1)", [con(C), pro(P1)], SIN_MEZCLA);
  // Apagado no prohíbe las giras de una misma clase: solo separa las dos.
  await entra("visita + prospecto sin mezclar: los dos son comerciales", [vis(OX), pro(P1)]);
  await politica({ ...COMERCIAL, topes: { contrato: 2 }, mezclar: false });
  await entra("dos contratos sin mezclar", [con(C), con(C2)]);
  await politica({ ...COMERCIAL, mezclar: true });
  await entra("contrato + visita mezclando (topes en 1)", [con(C), vis(OX)]);

  await politica({ ...COMERCIAL, topes: { contrato: 3, visita: 3, prospecto: 3 }, mezclar: true });
  // Lo que no es política sino dato: un destino no se repite, se mezcle o no.
  await noEntra("el mismo contrato dos veces", [con(C), con(C)], REPETIDO);
  await noEntra("la misma empresa como visita y como prospecto", [vis(OX), pro(OX)], REPETIDO);

  /* ── 5 · que cada destino sea lo que dice ────────────────────────────── */
  seccion("la clasificación: una visita es a un cliente SIN contrato vigente; un prospecto, a quien no ha comprado");

  // Todo encendido: lo que se rechace aquí no es la política, es el dato.
  await politica({ visitas: ["general"], prospectos: ["general"], topes: { contrato: 3, visita: 3, prospecto: 3 }, mezclar: true });
  const VIGENTE = (o: string) =>
    `«${nombres.get(o)}» tiene contrato vigente: el viaje va por su contrato, para que el gasto entre en su utilidad.`;
  await noEntra("visita a un cliente CON contrato vigente", [vis(OV)], VIGENTE(OV));
  await noEntra(
    "visita a un cliente con contrato vigente que salió de su negocio",
    [vis(ON)],
    VIGENTE(ON),
  );
  // Aunque vaya en una gira con destinos buenos: se valida cada uno.
  await noEntra("una gira con un destino bueno y uno vigente", [con(C), vis(OV)], VIGENTE(OV));
  await noEntra(
    "visita a quien NO es cliente",
    [vis(P1)],
    `«${nombres.get(P1)}» todavía no es cliente: su viaje se pide como prospecto.`,
  );
  const YA_CLIENTE = (o: string) =>
    `«${nombres.get(o)}» ya es cliente: su viaje se pide como visita (o por su contrato, si tiene uno vigente).`;
  await noEntra("prospecto que ya es cliente (cuenta enlazada)", [pro(OX)], YA_CLIENTE(OX));
  await noEntra("prospecto que ya es cliente (negocio ganado)", [pro(OG)], YA_CLIENTE(OG));
  const AJENO_NEG = "Uno de los negocios no es de la empresa a la que se viaja.";
  await noEntra("prospecto con el negocio de OTRA empresa", [pro(P1, DP2)], AJENO_NEG);
  await noEntra("visita con el negocio de OTRA empresa", [vis(OX, DP1)], AJENO_NEG);
  await noEntra("prospecto con un negocio CERRADO", [pro(P1, DP1L)], "Solo se cuelga el viaje de un negocio abierto.");
  await noEntra("una empresa que no existe", [vis(FANTASMA)], "Una de las empresas del viaje ya no existe.");
  await noEntra("un contrato que no existe", [con(FANTASMA)], "Uno de los contratos ya no existe.");

  /* ── 6 · enviar ──────────────────────────────────────────────────────── */
  seccion("enviar: solo quien lo pidió, y con «editar»");

  const enviar = (id: string) => () => v.enviarViaticoAction(ini, forma({ id }));
  /*
    Enviar es parte de PEDIR, que la cabecera de la acción reserva a
    `viaticos:editar`. No lo comprobaba: quien había perdido el módulo seguía
    pudiendo mover su borrador. Lo encontró este probe.
  */
  await guardia("enviar", S, "viaticos:ver", "No tienes permiso para enviar viáticos.", enviar(V1), TODO(V1));

  como(O);
  await rechazaSinEscribir(
    "enviar el borrador de OTRO, aunque administre",
    enviar(V1),
    TODO(V1),
    conError("Solo quien lo pidió puede enviarlo."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir("enviar, id que no es uuid", enviar("x"), TODO(V1), conError("Viático inválido."));
  await rechazaSinEscribir("enviar, viático que no existe", enviar(FANTASMA), TODO(V1), conError("El viático no existe."));

  let r = await llamar(enviar(V1));
  f = await fila(V1);
  ok("enviar responde ok", r.ok === true, r.error);
  ok("queda enviado y con fecha de envío", f?.status === "enviado" && f?.submitted_at !== null, f?.status);
  ok("y le llega el aviso al aprobador nombrado", await avisoPara(V1, A, "viatico.enviado"));
  ok(
    "y a nadie más: el otro administrador no se entera",
    (await cuantos("notifications", `where viatico_id = '${V1}' and user_id = '${O}'`)) === 0,
  );

  /* ── 7 · autorizar ───────────────────────────────────────────────────── */
  seccion("autorizar: «administrar», y además ser el aprobador y no el solicitante");

  const autorizar = (id: string, campos: Record<string, string> = {}) => () =>
    v.autorizarViaticoAction(ini, forma({ id, authorizedMxn: "4000", ...campos }));
  await guardia(
    "autorizar",
    A,
    "viaticos:editar",
    "No tienes permiso para autorizar viáticos.",
    autorizar(V1),
    TODO(V1),
  );

  /*
    LA SEPARACIÓN DE FUNCIONES, con la sesión en dos personas distintas.

    S tiene el módulo entero —es General— y aun así no firma lo suyo, ni
    colando un `actorId` con el id del aprobador. O también administra, pero el
    documento está a nombre de A.
  */
  const PEDISTE = "No puedes firmar un viático que pediste tú. Tiene que revisarlo otra persona.";
  const DE_OTRO =
    "Este viático está a nombre de otra persona para firmar. Reasignalo si tiene que resolverlo alguien más.";
  como(S);
  await rechazaSinEscribir("autorizar lo que uno mismo pidió", autorizar(V1), TODO(V1), conError(PEDISTE));
  await rechazaSinEscribir(
    "autorizar lo propio colando el actorId del aprobador",
    autorizar(V1, { actorId: A, userId: A }),
    TODO(V1),
    conError(PEDISTE),
  );
  como(O);
  await rechazaSinEscribir("autorizar lo que está a nombre de otro", autorizar(V1), TODO(V1), conError(DE_OTRO));

  como(A, "viaticos:administrar");
  for (const [nombre, monto, mensaje] of [
    ["monto que no es número", "abc", "Pon el monto que autorizas."],
    ["monto vacío", "", "Pon el monto que autorizas."],
    ["monto negativo", "-100", "Autorizar cero es rechazar. Usa «Rechazar» y di por qué."],
    ["monto en cero", "0", "Autorizar cero es rechazar. Usa «Rechazar» y di por qué."],
    // `Number("1e12")` es un número, y no cabe en `numeric(12,2)`: reventaba.
    ["monto que no cabe en la columna", "1e12", "No se pudo autorizar el viático."],
  ] as const) {
    await rechazaSinEscribir(
      `autorizar, ${nombre}`,
      autorizar(V1, { authorizedMxn: monto }),
      TODO(V1),
      conError(mensaje),
    );
  }
  await rechazaSinEscribir("autorizar, id que no es uuid", autorizar("x"), TODO(V1), conError("Viático inválido."));

  r = await llamar(autorizar(V1, { authorizedMxn: "$4,000.00", note: "  Solo lo del hotel  " }));
  f = await fila(V1);
  ok("autorizar responde ok", r.ok === true, r.error);
  ok("queda autorizado", f?.status === "autorizado", f?.status);
  ok("firmado por quien tiene la sesión", f?.approved_by_id === A);
  ok("con el monto autorizado, no el pedido", f?.authorized_mxn === "4000.00", f?.authorized_mxn ?? "null");
  ok("y la nota recortada", f?.approval_note === "Solo lo del hotel", f?.approval_note ?? "null");
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.autorizado"));

  /* ── 8 · rechazar ────────────────────────────────────────────────────── */
  seccion("rechazar: el mismo reparto que autorizar, y con motivo");

  const VR = await viatico("enviado");
  const rechazar = (id: string, reason = "El cliente movió la visita") => () =>
    v.rechazarViaticoAction(ini, forma({ id, reason }));
  await guardia(
    "rechazar",
    A,
    "viaticos:editar",
    "No tienes permiso para rechazar viáticos.",
    rechazar(VR),
    TODO(VR),
  );
  como(S);
  await rechazaSinEscribir("rechazar lo que uno mismo pidió", rechazar(VR), TODO(VR), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("rechazar lo que está a nombre de otro", rechazar(VR), TODO(VR), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "rechazar sin motivo",
    rechazar(VR, "   "),
    TODO(VR),
    conError("Hay que decir por qué se rechaza."),
  );
  r = await llamar(rechazar(VR));
  f = await fila(VR);
  ok("rechazar responde ok", r.ok === true, r.error);
  ok(
    "queda rechazado, firmado por el aprobador y con el motivo",
    f?.status === "rechazado" &&
      f?.approved_by_id === A &&
      f?.resolution_reason === "El cliente movió la visita",
    `${f?.status} · ${f?.resolution_reason}`,
  );
  ok("y el solicitante recibe el aviso", await avisoPara(VR, S, "viatico.rechazado"));

  /* ── 9 · agregar gasto ───────────────────────────────────────────────── */
  seccion("agregar gasto: «editar», solo el que viajó y solo en «autorizado»");

  const GASTO = {
    viaticoId: V1,
    destino: "ticket",
    ticketId: T1,
    rubroId: HOTEL,
    description: `${MARCA} hotel dos noches`,
    amountMxn: "$1,200.50",
    spentOn: "2026-10-02",
  };
  const agregar = (campos: Record<string, string> = {}) => () =>
    v.agregarGastoAction(ini, forma({ ...GASTO, ...campos }));

  await guardia(
    "agregar gasto",
    S,
    "viaticos:ver",
    "No tienes permiso para capturar gastos.",
    agregar(),
    TODO(V1),
  );

  // El aprobador tiene el módulo entero y el viático delante, y no es suyo.
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR carga un gasto en el viático que firma",
    agregar(),
    TODO(V1),
    conError("Solo quien viajó carga sus gastos."),
  );
  como(O);
  await rechazaSinEscribir(
    "otro administrador carga un gasto en un viático ajeno",
    agregar(),
    TODO(V1),
    conError("Solo quien viajó carga sus gastos."),
  );

  como(S, "viaticos:editar");
  const VB = await viatico("borrador");
  const VREV = await viatico("en_revision");
  const GREV = await gastoSembrado(VREV);
  await rechazaSinEscribir(
    "gasto en un borrador, que aún no se autoriza",
    agregar({ viaticoId: VB }),
    TODO(VB),
    conError("No se pueden cargar gastos: está en «borrador»."),
  );
  await rechazaSinEscribir(
    "gasto en un viático que ya está en revisión",
    agregar({ viaticoId: VREV }),
    TODO(VREV),
    conError("Ya está en revisión. Pide que te lo devuelvan para cambiar algo."),
  );
  await rechazaSinEscribir(
    "gasto en un viático RECHAZADO",
    agregar({ viaticoId: VR }),
    TODO(VR),
    conError("No se pueden cargar gastos: está en «rechazado»."),
  );

  const NO_ES_DEL_VIAJE = "Ese ticket no es de un equipo de los contratos de este viaje.";
  const SOLO_TICKETS = "Este viático es de un contrato: cada gasto va a un ticket del servicio.";
  const malos: Array<[string, Record<string, string>, string | null]> = [
    ["viático que no es uuid", { viaticoId: "x" }, "Viático inválido."],
    ["ticket que no es uuid", { ticketId: "no-soy-un-uuid" }, "Elige a qué ticket de servicio pertenece el gasto."],
    ["sin rubro", { rubroId: "" }, "Elige un rubro de gasto."],
    ["rubro que no existe", { rubroId: FANTASMA }, "Ese rubro de gasto no existe."],
    ["sin descripción", { description: "  " }, "Describe el gasto."],
    ["importe que no es número", { amountMxn: "abc" }, "Pon un importe mayor que cero."],
    ["importe con letras detrás", { amountMxn: "12abc" }, "Pon un importe mayor que cero."],
    ["importe negativo", { amountMxn: "-50" }, "Pon un importe mayor que cero."],
    ["importe en cero", { amountMxn: "0" }, "Pon un importe mayor que cero."],
    ["fecha con otro formato", { spentOn: "02/10/2026" }, "Falta la fecha del gasto."],
    /*
      Estos dos pasaban la validación y reventaban en Postgres —fecha fuera de
      rango, llave foránea—: la acción no tenía `catch` y la pantalla se caía
      con un error en vez de decir qué pasaba. Los encontró este probe.
    */
    ["fecha que no existe (30 de febrero)", { spentOn: "2026-02-30" }, "Falta la fecha del gasto."],
    // Reventaba contra la llave foránea. Desde que el dominio exige que el
    // ticket sea de un equipo de los contratos del viaje, lo frena ANTES.
    ["ticket bien formado que no existe", { ticketId: FANTASMA }, NO_ES_DEL_VIAJE],
    ["importe que no cabe en la columna", { amountMxn: "99999999999" }, "No se pudo agregar el gasto."],
    // Un viático de UN contrato carga cada gasto a un ticket del servicio: ni
    // comercial suelto, ni «general» —con un destino, el general es de ése—.
    ["gasto comercial suelto en un viático de contrato", { destino: "comercial" }, SOLO_TICKETS],
    ["gasto «general» en un viático de un solo contrato", { opcion: "general" }, SOLO_TICKETS],
    // La opción nueva manda sobre los tres campos viejos, y se sanea igual.
    ["opción de ticket que no es uuid", { opcion: "ticket:x" }, "Elige a qué se carga el gasto."],
    ["opción de una clase que no existe", { opcion: `crucero:${T1}` }, "Elige a qué se carga el gasto."],
  ];
  for (const [nombre, campos, mensaje] of malos) {
    await rechazaSinEscribir(
      `agregar gasto, ${nombre}`,
      agregar(campos),
      TODO(V1),
      mensaje ? conError(mensaje) : undefined,
    );
  }

  /*
    UN TICKET DE OTRO CONTRATO. El formulario solo ofrece los tickets del
    contrato (`ticketsDelContrato`), pero el dominio no lo comprobaba: con el id
    cambiado a mano, la cena del viaje al contrato X quedaba cargada a un
    servicio del contrato Y y, al cerrar, entraba en la utilidad del contrato
    equivocado. Este probe lo encontró en rojo, y `domain/viaticos.ts` ahora
    exige que el ticket sea de un equipo que ampare un contrato DEL VIAJE.
  */
  const VTX = await viatico("autorizado");
  await rechazaSinEscribir(
    "agregar gasto a un ticket de OTRO contrato",
    agregar({ viaticoId: VTX, ticketId: TX }),
    TODO(VTX),
    conError(NO_ES_DEL_VIAJE),
  );

  r = await llamar(agregar());
  ok("agregar gasto responde ok", r.ok === true, r.error);
  ok(
    "y avisa que va sin comprobante",
    r.message === "Gasto agregado, SIN comprobante.",
    r.message,
  );
  const g1 = await gastoPor("hotel dos noches");
  ok("el gasto está en la base, en su viático", Boolean(g1));
  ok("cargado al ticket elegido y a ningún negocio", g1?.ticket_id === T1 && g1?.deal_id === null);
  ok("y el destino lo DEDUCE: el único, el del contrato", g1?.destino_id === dV1[0]?.id, g1?.destino_id ?? "null");
  ok("con su rubro", g1?.rubro_id === HOTEL);
  ok("el importe, sin símbolo ni comas", g1?.amount_mxn === "1200.50", g1?.amount_mxn);
  const [comprobante] = await filas<{ receipt_path: string | null }>(
    `select receipt_path from ${ESQUEMA}.viatico_expenses where id = '${g1?.id ?? FANTASMA}'`,
  );
  ok("sin nota y sin comprobante", g1?.note === null && comprobante?.receipt_path === null);

  r = await llamar(
    agregar({ rubroId: OTROS, note: "  paquetería  ", amountMxn: "80", description: `${MARCA} envío` }),
  );
  ok("un gasto de «otros» con su nota entra", r.ok === true, r.error);
  const g2 = await gastoPor("envío");
  ok("y la nota se guarda recortada", g2?.note === "paquetería", g2?.note ?? "null");

  /* ── 10 · quitar gasto ───────────────────────────────────────────────── */
  seccion("quitar gasto: las mismas condiciones que ponerlo");

  const G2 = g2?.id ?? FANTASMA;
  const quitar = (gastoId: string) => () => v.quitarGastoAction(ini, forma({ gastoId }));
  /*
    Quitar tampoco miraba el módulo, al revés que agregar: con «ver» —o sin
    nada— el que viajó podía borrar renglones de su comprobación. Lo encontró
    este probe.
  */
  await guardia("quitar gasto", S, "viaticos:ver", "No tienes permiso para quitar gastos.", quitar(G2), TODO(V1));
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR quita un gasto del viático que firma",
    quitar(G2),
    TODO(V1),
    conError("Solo quien viajó puede quitar sus gastos."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir(
    "quitar un gasto de un viático en revisión",
    quitar(GREV),
    TODO(VREV),
    conError("No se pueden quitar gastos: está en «en_revision»."),
  );
  await rechazaSinEscribir("quitar, id que no es uuid", quitar("x"), TODO(V1), conError("Gasto inválido."));
  await rechazaSinEscribir("quitar, gasto que no existe", quitar(FANTASMA), TODO(V1), conError("El gasto no existe."));

  r = await llamar(quitar(G2));
  ok("quitar responde ok", r.ok === true, r.error);
  ok("el gasto se fue", (await cuantos("viatico_expenses", `where id = '${G2}'`)) === 0);
  ok("y el otro sigue ahí", (await cuantos("viatico_expenses", `where viatico_id = '${V1}'`)) === 1);

  /* ── 11 · mandar a revisión ──────────────────────────────────────────── */
  seccion("mandar a revisión: el que viajó, con «editar»");

  const mandar = (id: string) => () => v.mandarARevisionAction(ini, forma({ id }));
  await guardia(
    "mandar a revisión",
    S,
    "viaticos:ver",
    "No tienes permiso para mandar la comprobación.",
    mandar(V1),
    TODO(V1),
  );
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR manda a revisión la comprobación de otro",
    mandar(V1),
    TODO(V1),
    conError("Solo quien viajó puede mandar su comprobación."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir("mandar, id que no es uuid", mandar("x"), TODO(V1), conError("Viático inválido."));

  r = await llamar(mandar(V1));
  f = await fila(V1);
  ok("mandar a revisión responde ok", r.ok === true, r.error);
  ok("queda en revisión, con fecha", f?.status === "en_revision" && f?.reported_at !== null, f?.status);
  ok("y el aprobador recibe el aviso", await avisoPara(V1, A, "viatico.comprobado"));

  /* ── 12 · reclasificar ───────────────────────────────────────────────── */
  seccion("reclasificar: «administrar», y solo el aprobador");

  const G1 = g1?.id ?? FANTASMA;
  const reclasificar = (campos: Record<string, string>) => () =>
    v.reclasificarGastoAction(ini, forma({ gastoId: G1, destino: "ticket", ticketId: T2, ...campos }));
  await guardia(
    "reclasificar",
    A,
    "viaticos:editar",
    "No tienes permiso para reclasificar gastos.",
    reclasificar({}),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("reclasificar lo que uno mismo pidió", reclasificar({}), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("reclasificar lo que está a nombre de otro", reclasificar({}), TODO(V1), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir("reclasificar, gasto que no es uuid", reclasificar({ gastoId: "x" }), TODO(V1), conError("Gasto inválido."));
  await rechazaSinEscribir(
    "reclasificar a un ticket que no es uuid",
    reclasificar({ ticketId: "x" }),
    TODO(V1),
    conError("Elige a qué ticket de servicio pertenece el gasto."),
  );
  await rechazaSinEscribir(
    "reclasificar a un negocio sin decir cuál",
    reclasificar({ destino: "negocio" }),
    TODO(V1),
    conError("Elige el negocio al que se carga el gasto."),
  );

  r = await llamar(reclasificar({}));
  const g1b = await gastoPor("hotel dos noches");
  ok("reclasificar responde ok", r.ok === true, r.error);
  ok("el gasto pasó al otro ticket", g1b?.ticket_id === T2);
  ok("del mismo contrato, así que sigue en el mismo destino", g1b?.destino_id === dV1[0]?.id);
  ok(
    "y queda escrito quién lo movió y cuándo",
    g1b?.reclassified_by_id === A && g1b?.reclassified_at !== null,
  );
  ok("sin tocar el importe", g1b?.amount_mxn === "1200.50", g1b?.amount_mxn);

  /* ── 13 · devolver ───────────────────────────────────────────────────── */
  seccion("devolver: «administrar», el aprobador, y con motivo");

  const devolver = (id: string, reason = "Falta la factura del hotel") => () =>
    v.devolverViaticoAction(ini, forma({ id, reason }));
  await guardia(
    "devolver",
    A,
    "viaticos:editar",
    "No tienes permiso para devolver viáticos.",
    devolver(V1),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("devolver lo que uno mismo pidió", devolver(V1), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("devolver lo que está a nombre de otro", devolver(V1), TODO(V1), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "devolver sin decir qué falta",
    devolver(V1, ""),
    TODO(V1),
    conError("Hay que decir qué falta corregir."),
  );

  r = await llamar(devolver(V1));
  f = await fila(V1);
  ok("devolver responde ok", r.ok === true, r.error);
  ok(
    "vuelve a autorizado, sin fecha de comprobación y con el motivo",
    f?.status === "autorizado" &&
      f?.reported_at === null &&
      f?.resolution_reason === "Falta la factura del hotel",
    f?.status,
  );
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.devuelto"));

  como(S, "viaticos:editar");
  r = await llamar(mandar(V1));
  ok("el que viajó lo vuelve a mandar", r.ok === true && (await fila(V1))?.status === "en_revision", r.error);

  /* ── 14 · cerrar ─────────────────────────────────────────────────────── */
  seccion("cerrar: el visto bueno, «administrar» y del aprobador");

  const cerrar = (id: string) => () => v.cerrarViaticoAction(ini, forma({ id, note: "  Cuadra  " }));
  await guardia(
    "cerrar",
    A,
    "viaticos:editar",
    "No tienes permiso para dar el visto bueno viáticos.",
    cerrar(V1),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("cerrar lo que uno mismo pidió", cerrar(V1), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("cerrar lo que está a nombre de otro", cerrar(V1), TODO(V1), conError(DE_OTRO));

  como(A, "viaticos:administrar");
  r = await llamar(cerrar(V1));
  f = await fila(V1);
  ok("cerrar responde ok", r.ok === true, r.error);
  ok("queda cerrado, firmado por el aprobador", f?.status === "cerrado" && f?.closed_by_id === A, f?.status);
  ok("con la nota recortada", f?.closing_note === "Cuadra", f?.closing_note ?? "null");
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.cerrado"));

  como(S, "viaticos:editar");
  await rechazaSinEscribir(
    "ya cerrado, no se le cargan gastos",
    agregar(),
    TODO(V1),
    conError("No se pueden cargar gastos: está en «cerrado»."),
  );

  /* ── 15 · reasignar ──────────────────────────────────────────────────── */
  seccion("reasignar: «administrar», sin ser el aprobador, y nunca al solicitante");

  const VREAS = await viatico("enviado");
  const reasignar = (id: string, approverId: string) => () =>
    v.reasignarViaticoAction(ini, forma({ id, approverId }));
  // La guardia de módulo de reasignar vive en el dominio: la acción le pasa el
  // permiso ya resuelto. El mensaje es el suyo.
  await guardia(
    "reasignar",
    A,
    "viaticos:editar",
    "No tienes permiso para reasignar viáticos.",
    reasignar(VREAS, O),
    TODO(VREAS),
  );
  como(O, "viaticos:administrar");
  await rechazaSinEscribir("reasignar, id que no es uuid", reasignar("x", O), TODO(VREAS), conError("Viático inválido."));
  await rechazaSinEscribir(
    "reasignar a alguien que no es uuid",
    reasignar(VREAS, "x"),
    TODO(VREAS),
    conError("Elige a quién se lo pasas."),
  );
  await rechazaSinEscribir(
    "reasignarle la firma AL SOLICITANTE",
    reasignar(VREAS, S),
    TODO(VREAS),
    conError("No puedes mandarte a firmar tu propio viático. Elige a otra persona."),
  );

  r = await llamar(reasignar(VREAS, O));
  ok("reasignar responde ok, sin ser el aprobador actual", r.ok === true, r.error);
  ok("queda a nombre del nuevo", (await fila(VREAS))?.approver_id === O);
  ok("y el nuevo recibe el aviso", await avisoPara(VREAS, O, "viatico.reasignado"));
  // Y la consecuencia que justifica reasignar explícitamente: el de antes ya no firma.
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "el aprobador ANTERIOR ya no puede autorizar",
    autorizar(VREAS),
    TODO(VREAS),
    conError(DE_OTRO),
  );

  /* ── 16 · cancelar ───────────────────────────────────────────────────── */
  seccion("cancelar: el que pidió, o quien administra; nadie más");

  const cancelar = (id: string, reason = "Se canceló la visita") => () =>
    v.cancelarViaticoAction(ini, forma({ id, reason }));
  const NO_PUEDES = "No puedes cancelar este viático.";
  como(null);
  await rechazaSinEscribir("cancelar, sin sesión", cancelar(VB), TODO(VB), conError("No hay sesión."));
  como(O, false);
  await rechazaSinEscribir("cancelar lo ajeno sin permiso", cancelar(VB), TODO(VB), conError(NO_PUEDES));
  /*
    Un escalón menos: el aprobador con «editar» no es quien pidió, así que
    necesita «administrar». Que la acción no bloquee por módulo es deliberado
    —el que viaja cancela sin administrar—, y por eso lo que hay que comprobar
    es que el permiso que le pasa al dominio sea el de «administrar» y no otro.
  */
  como(A, "viaticos:editar");
  await rechazaSinEscribir("cancelar lo ajeno con «editar»", cancelar(VB), TODO(VB), conError(NO_PUEDES));
  como(S, "viaticos:editar");
  await rechazaSinEscribir("cancelar, id que no es uuid", cancelar("x"), TODO(VB), conError("Viático inválido."));
  await rechazaSinEscribir(
    "cancelar sin motivo",
    cancelar(VB, " "),
    TODO(VB),
    conError("Hay que decir por qué se cancela."),
  );

  r = await llamar(cancelar(VB));
  f = await fila(VB);
  ok("el que pidió cancela su borrador con «editar»", r.ok === true, r.error);
  ok(
    "queda cancelado y con el motivo",
    f?.status === "cancelado" && f?.resolution_reason === "Se canceló la visita",
    f?.status,
  );

  const VCANC = await viatico("autorizado");
  como(O, "viaticos:administrar");
  r = await llamar(cancelar(VCANC, "Viaje duplicado"));
  ok(
    "quien administra cancela un viático ajeno ya autorizado",
    r.ok === true && (await fila(VCANC))?.status === "cancelado",
    r.error,
  );

  /* ── 17 · gastos en un viaje de varios destinos ──────────────────────── */
  seccion("gastos en una gira: cada uno cae en SU destino, o en ninguno");

  /*
    LA GIRA: dos contratos, una visita y un prospecto con negocio, pedida,
    enviada y autorizada por las acciones —no sembrada—: es el camino real de
    un viaje de varios destinos, de punta a punta.
  */
  // Dos contratos y un destino de cada tipo comercial: los topes justos, por tipo.
  await politica({ visitas: ["general"], prospectos: ["general"], topes: { contrato: 2 }, mezclar: true });
  como(S, "viaticos:editar");
  const gira = await entra("la gira de cuatro destinos", [con(C), con(C2), vis(OG), pro(P1, DP1)]);
  const VM = gira.id;
  const [dC, dC2, dV, dP] = gira.d.map((d) => d.id);
  r = await llamar(enviar(VM));
  como(A, "viaticos:administrar");
  const r2 = await llamar(autorizar(VM, { authorizedMxn: "20000" }));
  ok("la gira se envía y se autoriza", r.ok && r2.ok && (await fila(VM))?.status === "autorizado", r.error ?? r2.error);

  como(S, "viaticos:editar");
  const cargar = (descripcion: string, monto: string, campos: Record<string, string>) => () =>
    v.agregarGastoAction(
      ini,
      forma({
        viaticoId: VM,
        rubroId: HOTEL,
        description: `${MARCA} ${descripcion}`,
        amountMxn: monto,
        spentOn: "2026-10-02",
        ...campos,
      }),
    );
  /*
    Importes que no se confunden al sumarse —50 por una potencia de dos cada
    uno—: ninguna combinación de gastos da el mismo total que otra, así que un
    total dice por sí solo qué gastos entraron en él.
  */
  type Carga = {
    desc: string;
    etiqueta: string;
    monto: string;
    campos: Record<string, string>;
    destino: string | null;
    ticket?: string;
    deal?: string;
  };
  const CARGAS: Carga[] = [
    { desc: "g-t1", etiqueta: "ticket del primer contrato", monto: "100", campos: { opcion: `ticket:${T1}` }, destino: dC, ticket: T1 },
    { desc: "g-t2", etiqueta: "otro ticket del primer contrato", monto: "50", campos: { opcion: `ticket:${T2}` }, destino: dC, ticket: T2 },
    // El ticket del SEGUNDO contrato encuentra su destino, no el primero de la lista.
    { desc: "g-t3", etiqueta: "ticket del SEGUNDO contrato", monto: "200", campos: { opcion: `ticket:${T3}` }, destino: dC2, ticket: T3 },
    { desc: "g-negocio", etiqueta: "negocio del prospecto", monto: "400", campos: { opcion: `negocio:${DP1}` }, destino: dP, deal: DP1 },
    // El negocio no es solo cosa de prospectos: una visita también puede tenerlo.
    { desc: "g-negocio-visita", etiqueta: "negocio de la visita", monto: "800", campos: { opcion: `negocio:${DOG}` }, destino: dV, deal: DOG },
    { desc: "g-destino", etiqueta: "la visita a secas (`destino:<id>`)", monto: "1600", campos: { opcion: `destino:${dV}` }, destino: dV },
    { desc: "g-general", etiqueta: "general", monto: "3200", campos: { opcion: "general" }, destino: null },
    // La forma de antes de la 0037 —tres campos— sigue sirviendo, con nota de «otros».
    {
      desc: "g-vieja",
      etiqueta: "prospecto, con la forma vieja (`destino=comercial&destinoId`)",
      monto: "6400",
      campos: { destino: "comercial", destinoId: dP, rubroId: OTROS, note: "paquetería" },
      destino: dP,
    },
  ];
  for (const c of CARGAS) {
    const rr = await llamar(cargar(c.desc, c.monto, c.campos));
    const g = await gastoPor(c.desc);
    const bien =
      rr.ok === true &&
      g?.destino_id === c.destino &&
      g?.ticket_id === (c.ticket ?? null) &&
      g?.deal_id === (c.deal ?? null);
    const i = gira.d.findIndex((d) => d.id === c.destino);
    const donde = c.destino === null ? "ningún destino (gasto general)" : `el destino ${i + 1} (${gira.d[i]?.tipo})`;
    ok(
      `gasto «${c.etiqueta}» → ${donde}`,
      bien,
      bien ? "" : (rr.error ?? JSON.stringify({ destino: g?.destino_id, ticket: g?.ticket_id, deal: g?.deal_id })),
    );
  }

  const NO_EN_EL_VIAJE: Array<[string, Record<string, string>, string]> = [
    ["un ticket de un contrato que NO es del viaje", { opcion: `ticket:${TX}` }, NO_ES_DEL_VIAJE],
    [
      "un destino de CONTRATO a secas, sin ticket",
      { opcion: `destino:${dC}` },
      "El gasto de un contrato va a un ticket del servicio.",
    ],
    [
      "lo mismo con la forma vieja",
      { destino: "comercial", destinoId: dC2 },
      "El gasto de un contrato va a un ticket del servicio.",
    ],
    ["un destino de OTRO viaje", { opcion: `destino:${dV1[0]?.id ?? FANTASMA}` }, "Ese destino no es de este viaje."],
    [
      "un negocio de una empresa que no está en el viaje",
      { opcion: `negocio:${DP2}` },
      "Ese negocio no es de ninguna de las empresas de este viaje.",
    ],
  ];
  for (const [nombre, campos, mensaje] of NO_EN_EL_VIAJE) {
    await rechazaSinEscribir(`gasto en la gira, ${nombre}`, cargar("rechazado", "10", campos), TODO(VM), conError(mensaje));
  }

  /* ── un solo destino de visita ── */
  seccion("un viaje de UN destino comercial: lo que no dice a dónde va, va a ése");

  await politica({ visitas: ["general"] });
  const sola = await entra("una visita sola", [vis(OX)]);
  const VV = sola.id;
  const dVV = sola.d[0]?.id;
  await llamar(enviar(VV));
  como(A, "viaticos:administrar");
  await llamar(autorizar(VV));
  como(S, "viaticos:editar");
  const cargarVV = (descripcion: string, campos: Record<string, string>) => () =>
    v.agregarGastoAction(
      ini,
      forma({
        viaticoId: VV,
        rubroId: HOTEL,
        description: `${MARCA} ${descripcion}`,
        amountMxn: "75",
        spentOn: "2026-10-02",
        ...campos,
      }),
    );
  for (const [descripcion, campos, etiqueta] of [
    ["vv-comercial", { destino: "comercial" }, "«comercial» sin destino (forma vieja)"],
    ["vv-general", { opcion: "general" }, "«general»"],
    ["vv-destino", { opcion: `destino:${dVV}` }, "su destino, nombrado"],
    ["vv-negocio", { opcion: `negocio:${DOX}` }, "su negocio"],
  ] as const) {
    const rr = await llamar(cargarVV(descripcion, campos));
    const g = await gastoPor(descripcion);
    ok(
      `con una visita sola, ${etiqueta} cae en la visita`,
      rr.ok === true && Boolean(dVV) && g?.destino_id === dVV,
      rr.error ?? (g?.destino_id === dVV ? "" : `quedó en ${g?.destino_id}`),
    );
  }
  await rechazaSinEscribir(
    "con una visita sola, un ticket",
    cargarVV("vv-ticket", { opcion: `ticket:${T1}` }),
    TODO(VV),
    conError("Este viaje no va a ningún contrato, y los tickets son de un contrato. Cárgalo al negocio o a la visita."),
  );

  /* ── reclasificar entre destinos ── */
  seccion("reclasificar en la gira: quien firma mueve el gasto de un destino a otro");

  const reclasificarA = (descripcion: string, opcion: string) => async () =>
    v.reclasificarGastoAction(ini, forma({ gastoId: (await gastoPor(descripcion))?.id ?? FANTASMA, opcion }));

  // Antes de mandarla a revisión no se mueve nada: el que viaja sigue escribiendo.
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "reclasificar en la gira antes de la revisión",
    reclasificarA("g-general", `destino:${dP}`),
    TODO(VM),
    conError("Solo se reclasifica mientras la comprobación está en revisión."),
  );
  como(S, "viaticos:editar");
  r = await llamar(mandar(VM));
  ok("la gira se manda a revisión", r.ok === true, r.error);

  como(A, "viaticos:administrar");
  for (const [descripcion, opcion, destino, etiqueta] of [
    ["g-general", `destino:${dP}`, dP, "el gasto GENERAL pasa al prospecto"],
    ["g-destino", "general", null, "el de la visita pasa a GENERAL"],
    ["g-t1", `ticket:${T3}`, dC2, "el del ticket del primer contrato pasa a un ticket del segundo, y de destino"],
  ] as const) {
    const rr = await llamar(reclasificarA(descripcion, opcion));
    const g = await gastoPor(descripcion);
    ok(
      `reclasificar: ${etiqueta}`,
      rr.ok === true && g?.destino_id === destino && g?.reclassified_by_id === A,
      rr.error ?? (g?.destino_id === destino && g?.reclassified_by_id === A ? "" : `quedó en ${g?.destino_id}, movido por ${g?.reclassified_by_id}`),
    );
  }
  await rechazaSinEscribir(
    "reclasificar un gasto a un destino de contrato sin ticket",
    reclasificarA("g-negocio", `destino:${dC}`),
    TODO(VM),
    conError("El gasto de un contrato va a un ticket del servicio."),
  );
  // Quien pidió no reclasifica en la gira tampoco: la firma es una sola regla.
  como(S);
  await rechazaSinEscribir(
    "reclasificar en la gira lo que uno mismo pidió",
    reclasificarA("g-negocio", "general"),
    TODO(VM),
    conError(PEDISTE),
  );

  /* ── 18 · costos ─────────────────────────────────────────────────────── */
  seccion("el costo de la gira: a cada contrato y a cada empresa, lo SUYO");

  /*
    Tras reclasificar, la gira queda así:
      C   (dC)   g-t2                              50
      C2  (dC2)  g-t3 + g-t1                      300
      OG  (dV)   g-negocio-visita                 800
      P1  (dP)   g-negocio + g-vieja + g-general  10000 (6400 en «Otros»)
      general    g-destino                       1600
    Los contratos son de la siembra y pueden tener otros viajes cerrados —el
    V1 de arriba, sin ir más lejos—, así que se mide lo que SUMA cerrar la
    gira. Las empresas son de esta corrida y se miden enteras.
  */
  const datos = await import("@/lib/data/viaticos");
  const antesC = await datos.viaticosDelContrato(C);
  const antesC2 = await datos.viaticosDelContrato(C2);
  const antesP1 = await datos.viaticosDelProspecto(P1);
  ok("antes de cerrar, la gira no le cuesta nada a nadie", antesP1.costo === 0 && antesP1.viajes === 0, `${antesP1.costo} en ${antesP1.viajes} viaje(s)`);

  como(A, "viaticos:administrar");
  r = await llamar(cerrar(VM));
  ok("la gira se cierra", r.ok === true && (await fila(VM))?.status === "cerrado", r.error);

  const despuesC = await datos.viaticosDelContrato(C);
  const despuesC2 = await datos.viaticosDelContrato(C2);
  const deP1 = await datos.viaticosDelProspecto(P1);
  const deOG = await datos.viaticosDelProspecto(OG);
  ok(
    "al primer contrato solo le suma lo de su destino (50)",
    despuesC.costo - antesC.costo === 50 && despuesC.viajes - antesC.viajes === 1,
    `${despuesC.costo - antesC.costo} en ${despuesC.viajes - antesC.viajes} viaje(s)`,
  );
  ok(
    "al segundo, lo del suyo (300)",
    despuesC2.costo - antesC2.costo === 300 && despuesC2.viajes - antesC2.viajes === 1,
    `${despuesC2.costo - antesC2.costo} en ${despuesC2.viajes - antesC2.viajes} viaje(s)`,
  );
  ok("al prospecto, lo suyo (10000) en un viaje", deP1.costo === 10000 && deP1.viajes === 1, `${deP1.costo} en ${deP1.viajes} viaje(s)`);
  ok(
    "con su desglose por rubro",
    JSON.stringify(deP1.porCategoria) === JSON.stringify([{ k: "Otros", total: 6400 }, { k: "Hotel", total: 3600 }]),
    deP1.porCategoria.map((c) => `${c.k} ${c.total}`).join(", "),
  );
  ok("a la visita, lo suyo (800)", deOG.costo === 800 && deOG.viajes === 1, `${deOG.costo} en ${deOG.viajes} viaje(s)`);
  const [{ total: totalGira }] = await filas<{ total: string }>(
    `select sum(amount_mxn)::text as total from ${ESQUEMA}.viatico_expenses where viatico_id = '${VM}'`,
  );
  ok(
    "y el gasto general no entra en ninguno: los cuatro suman la gira MENOS el general",
    Number(totalGira) - 1600 ===
      despuesC.costo - antesC.costo + (despuesC2.costo - antesC2.costo) + deP1.costo + deOG.costo,
    `gira ${totalGira}`,
  );

  /* ── 19 · lo que leen las pantallas ──────────────────────────────────── */
  seccion("las lecturas: listado, ficha, visitables y opciones de gasto");

  const lista = await datos.listViaticos(S);
  const enLista = lista.find((x) => x.id === VM);
  ok(
    "el listado trae los destinos de la gira, en orden y con su nombre",
    JSON.stringify(enLista?.destinos) ===
      JSON.stringify([
        { tipo: "contrato", nombre: numeros.get(C) },
        { tipo: "contrato", nombre: numeros.get(C2) },
        { tipo: "visita", nombre: nombres.get(OG) },
        { tipo: "prospecto", nombre: nombres.get(P1) },
      ]),
    enLista?.destinos.map((d) => d.tipo).join(", "),
  );
  ok(
    "y el de un solo destino, uno",
    JSON.stringify(lista.find((x) => x.id === VV)?.destinos) ===
      JSON.stringify([{ tipo: "visita", nombre: nombres.get(OX) }]),
  );

  const ficha = await datos.getViatico(VM, S);
  ok(
    "la ficha trae los destinos con su id, en orden",
    JSON.stringify(ficha?.destinos.map((d) => [d.id, d.tipo])) ===
      JSON.stringify([[dC, "contrato"], [dC2, "contrato"], [dV, "visita"], [dP, "prospecto"]]),
    JSON.stringify(ficha?.destinos.map((d) => d.tipo)),
  );
  const fp = ficha?.destinos[3];
  const fc = ficha?.destinos[0];
  ok(
    "con el detalle de cada uno: número del contrato, nombre de la empresa y su negocio",
    fc?.contractNumber === numeros.get(C) &&
      fp?.organizacion === nombres.get(P1) &&
      fp?.dealId === DP1 &&
      fp?.negocio === titulos.get(DP1),
  );
  ok(
    "y cada gasto dice en qué destino está",
    ficha?.gastos.find((g) => g.description === `${MARCA} g-destino`)?.destinoId === null &&
      ficha?.gastos.find((g) => g.description === `${MARCA} g-negocio`)?.destinoId === dP,
  );
  ok("la ficha de un viático ajeno no se abre con otra sesión", (await datos.getViatico(VM, O)) === null);

  const visitables = new Set((await datos.visitasParaViatico()).map((o) => o.id));
  ok(
    "se pueden visitar: el cliente con contrato VENCIDO y el de negocio ganado",
    visitables.has(OX) && visitables.has(OG),
  );
  ok(
    "no: el cliente con contrato vigente (por cuenta o por negocio) ni los prospectos",
    !visitables.has(OV) && !visitables.has(ON) && !visitables.has(P1) && !visitables.has(P2),
  );

  const opciones = new Set((await datos.opcionesDeGasto(ficha?.destinos ?? [])).map((o) => o.value));
  const deberian = [
    `ticket:${T1}`,
    `ticket:${T2}`,
    `ticket:${T3}`,
    `destino:${dV}`,
    `negocio:${DOG}`,
    `destino:${dP}`,
    `negocio:${DP1}`,
    "general",
  ];
  ok(
    "las opciones de la gira: sus tickets, sus visitas y prospectos, sus negocios y «general»",
    deberian.every((x) => opciones.has(x)),
    deberian.filter((x) => !opciones.has(x)).join(", "),
  );
  ok(
    "y no: el contrato a secas, un negocio cerrado ni uno de otra empresa",
    !opciones.has(`destino:${dC}`) && !opciones.has(`negocio:${DP1L}`) && !opciones.has(`negocio:${DP2}`),
  );
  const fichaVV = await datos.getViatico(VV, S);
  const opcionesVV = (await datos.opcionesDeGasto(fichaVV?.destinos ?? [])).map((o) => o.value);
  ok(
    "con un solo destino no se ofrece «general»: el general ES de ése",
    !opcionesVV.includes("general") && opcionesVV.includes(`destino:${dVV}`) && opcionesVV.includes(`negocio:${DOX}`),
    opcionesVV.includes("general") ? "ofreció «general»" : "",
  );

  /* ── 20 · aislamiento ────────────────────────────────────────────────── */
  seccion("lo escrito se queda en la empresa de la sesión");

  ok(
    `el viático creado está en ${ESQUEMA}`,
    (await cuantos("viaticos", `where id = '${V1}'`)) === 1,
  );
  ok(
    `con sus destinos en ${ESQUEMA}`,
    (await cuantos("viatico_destinos", `where viatico_id = '${VM}'`)) === 4,
  );
  ok(
    `y ${AJENO} no tiene nada con la marca`,
    (await cuantos("viaticos", `where destination like '${MARCA}%'`, AJENO)) === 0,
  );
  ok(
    `ni destinos a las empresas ni a los contratos de la prueba en ${AJENO}`,
    (await cuantos(
      "viatico_destinos",
      `where organization_id in ('${OV}', '${ON}', '${OX}', '${OG}', '${P1}', '${P2}')
          or contract_id in ('${C}', '${C2}')`,
      AJENO,
    )) === 0,
  );
  ok(
    `ni gastos con la marca en ${AJENO}`,
    (await cuantos("viatico_expenses", `where description like '${MARCA}%'`, AJENO)) === 0,
  );
  ok(
    `ni avisos de viáticos para las personas de la prueba en ${AJENO}`,
    (await cuantos(
      "notifications",
      `where user_id in ('${S}', '${A}', '${O}')`,
      AJENO,
    )) === 0,
  );
  ok(
    `y la política de ${AJENO} no se movió con la de ${ESQUEMA}`,
    (await foto(AJUSTES(AJENO))) === ajenoAntes,
  );
});
