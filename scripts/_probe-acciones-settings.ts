/**
 * LAS ACCIONES DE CONFIGURACIÓN: TARIFAS Y TIPO DE CAMBIO.
 *
 * El tipo de cambio pide `configuracion: administrar`; las tarifas de mano de
 * obra, `servicio: administrar` (Configuración → Servicio).
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
 *     scripts/_probe-acciones-settings.ts
 *
 * Tres acciones sobre UNA fila (`settings`, id `global`). Ninguna crea filas,
 * todas actualizan, así que contar no sirve de nada: la guardia se comprueba
 * con la fila entera antes y después.
 *
 * Lo que vale la pena atar aquí es el signo. Un tipo de cambio de cero
 * convertiría toda la cartera en dólares a cero pesos; vacío, en cambio, es una
 * decisión —«esta empresa no convierte»— y tiene que BORRAR el valor, no
 * rechazarse.
 */
import {
  ESQUEMA,
  alLimpiar,
  como,
  conError,
  filas,
  forma,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const FILA = `select usd_rate, tipo_cambio_automatico, labor_cost_per_hour, labor_rate_per_hour
                from ${ESQUEMA}.settings where id = 'global'`;

type Fila = {
  usd_rate: string | null;
  tipo_cambio_automatico: boolean;
  labor_cost_per_hour: string | null;
  labor_rate_per_hour: string | null;
};

void probar("configuración: guardia, validación y lo que se guarda", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    Se guarda la fila como estaba y se repone al final. Si no existía, se borra
    la que hayan creado las acciones (todas hacen upsert).
  */
  const [original] = await filas<Fila>(FILA);
  alLimpiar(async () => {
    if (!original) return sql.unsafe(`delete from ${ESQUEMA}.settings where id = 'global'`);
    return sql.unsafe(
      `update ${ESQUEMA}.settings set usd_rate = $1, tipo_cambio_automatico = $2,
              labor_cost_per_hour = $3, labor_rate_per_hour = $4 where id = 'global'`,
      [
        original.usd_rate,
        original.tipo_cambio_automatico,
        original.labor_cost_per_hour,
        original.labor_rate_per_hour,
      ],
    );
  });

  const s = await import("@/lib/actions/settings");
  const inicial = { ok: false };

  /* ── 1 · la guardia ──────────────────────────────────────────────────── */
  seccion("sin permiso, ninguna toca la fila");
  const llamadas = [
    ["tipo de cambio", () => s.updateFxRate(inicial, forma({ usdRate: "99.5" }))],
    ["tipo automático", () => s.updateTipoCambioAutomatico(inicial, forma({ automatico: "on" }))],
    [
      "tarifas",
      () => s.updateSettings(inicial, forma({ laborCostPerHour: "1", laborRatePerHour: "2" })),
    ],
  ] as const;

  como(ACTOR, false);
  for (const [nombre, fn] of llamadas)
    await rechazaSinEscribir(`${nombre}, sin permiso`, fn, [FILA], conError("auth"));

  /*
    Un escalón menos del que piden. Cambiar el tipo de cambio mueve todos los
    informes en dólares de la empresa: no es trabajo del día. Las tarifas piden
    `servicio: administrar` (su pestaña es Configuración → Servicio), así que
    «editar» se prueba en el módulo de cada una.
  */
  const [fx, automatico, tarifas] = llamadas;
  como(ACTOR, "configuracion:editar");
  for (const [nombre, fn] of [fx, automatico])
    await rechazaSinEscribir(`${nombre}, con «configuracion:editar»`, fn, [FILA], conError("auth"));
  como(ACTOR, "servicio:editar");
  await rechazaSinEscribir(`${tarifas[0]}, con «servicio:editar»`, tarifas[1], [FILA], conError("auth"));
  /*
    LAS TARIFAS SON DE SERVICIO, NO DEL SISTEMA. Vivían en «Marca y tarifas»
    bajo `configuracion: administrar`; ahora las decide quien administra el
    servicio. Administrar la configuración ya no alcanza, y administrar el
    servicio sí —sin tocar nada de configuración—.
  */
  como(ACTOR, "configuracion:administrar");
  await rechazaSinEscribir(
    `${tarifas[0]}, con «configuracion:administrar» y nada de servicio`,
    tarifas[1],
    [FILA],
    conError("auth"),
  );

  /* ── 2 · la captura inválida ─────────────────────────────────────────── */
  /*
    «-3» y «abc» se guardaban. La limpieza quitaba todo lo que no fuera dígito
    o punto: el signo desaparecía y «-3» entraba como 3, y «abc» quedaba vacío,
    que BORRA el tipo de cambio. Las dos las encontró este probe.
  */
  seccion("un tipo de cambio de cero, negativo o que no es número no se guarda");
  como(ACTOR, "configuracion:administrar");
  for (const v of ["0", "-3", "abc"])
    await rechazaSinEscribir(
      `tipo de cambio «${v}»`,
      () => s.updateFxRate(inicial, forma({ usdRate: v })),
      [FILA],
      conError("invalid"),
    );

  /* ── 3 · el camino feliz ─────────────────────────────────────────────── */
  seccion("con permiso, se guarda lo que se capturó");
  let r = await s.updateFxRate(inicial, forma({ usdRate: "$18.2345" }));
  let [f] = await filas<Fila>(FILA);
  ok("el tipo de cambio se guarda", r.ok === true, r.error);
  ok("limpio de símbolos y a cuatro decimales", f?.usd_rate === "18.2345", f?.usd_rate ?? "null");

  r = await s.updateFxRate(inicial, forma({ usdRate: "" }));
  [f] = await filas<Fila>(FILA);
  ok("vacío BORRA el tipo de cambio en vez de rechazarse", r.ok && f?.usd_rate === null, f?.usd_rate ?? "null");

  const antes = original?.tipo_cambio_automatico ?? false;
  r = await s.updateTipoCambioAutomatico(inicial, forma(antes ? {} : { automatico: "on" }));
  [f] = await filas<Fila>(FILA);
  ok("la casilla del automático se invierte", r.ok && f?.tipo_cambio_automatico === !antes);

  como(ACTOR, "servicio:administrar");
  r = await s.updateSettings(
    inicial,
    forma({ laborCostPerHour: "$1,234.5", laborRatePerHour: "-50" }),
  );
  [f] = await filas<Fila>(FILA);
  ok("las tarifas se guardan", r.ok === true, r.error);
  ok("el costo, sin comas ni símbolo", f?.labor_cost_per_hour === "1234.50", f?.labor_cost_per_hour ?? "null");
  ok(
    "una tarifa negativa se guarda como VACÍA, no como negativa",
    f?.labor_rate_per_hour === null,
    f?.labor_rate_per_hour ?? "null",
  );
});
