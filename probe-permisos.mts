/**
 * El modelo de permisos por persona NO cambia el acceso de nadie.
 *
 * Es la propiedad que permite desplegarlo sin reconfigurar una sola cuenta: con
 * el mapa de ajustes vacío —que es como quedan las 31 membresías existentes—,
 * cada rol tiene que ver EXACTAMENTE el mismo menú que antes.
 *
 * Los menús esperados están escritos a mano abajo, copiados de las tres listas
 * por rol que había antes de que existiera `permisos.ts`. Compararse contra el
 * código nuevo no probaría nada.
 *
 * ── LO QUE HA CAMBIADO SIN CAMBIAR EL ACCESO ──────────────────────────────
 *
 * Dos veces, y las dos quedan anotadas porque es justo lo que hay que poder
 * distinguir de una regresión:
 *
 *  · `/admin/crm/leads` pasó a `/admin/crm/prospectos` al deshacer el choque de
 *    nombres con la bandeja del formulario web. La dirección vieja redirige.
 *
 *  · `/admin/inteligencia` salió de la sección Análisis y encabeza ahora el
 *    grupo «Inteligencia», junto con los tableros. Es una mudanza de GRUPO: el
 *    renglón sigue estando y para los mismos roles.
 *
 * ── Y UNA VEZ QUE SÍ CAMBIÓ EL ACCESO, A PROPÓSITO ────────────────────────
 *
 * El módulo de VIÁTICOS es nuevo y añade `/admin/viaticos` en su propia sección
 * para quien pide viajes (agente) y para quien los firma (administrador, dueño
 * y el rol General). Este probe lo señaló al nacer, que es exactamente su
 * trabajo, y la expectativa se movió a mano después de mirar la diferencia.
 *
 * Lo que NO cambió es la mitad que importaba comprobar: `sales` y `client`
 * siguen con el menú y las direcciones de siempre. Un módulo nuevo que no le
 * regala acceso a nadie que no lo necesite es lo que permite desplegarlo sin
 * revisar cuenta por cuenta.
 *
 * Por eso, además del menú completo, se compara el CONJUNTO de direcciones que
 * ve cada rol. Esa es la propiedad que de verdad importa —quién llega a dónde—,
 * y no cambia aunque el menú se reordene entero.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-permisos.mts
 */
const { navFor } = await import("./src/lib/portal/menu.ts");
const { nivelEfectivo, exigenciaDe, puedeEntrar, alcanza, ajustesGuardados } =
  await import("./src/lib/permisos.ts");

const ok = (l: string, c: boolean, e = "") => console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; ok(l, c, e); };

/* ── Lo que cada rol veía ANTES, copiado de las listas por rol ── */
const ESPERADO: Record<string, Array<[string | undefined, string[]]>> = {
  client: [
    [undefined, ["/dashboard"]],
    ["Portal", ["/tickets", "/tickets/new"]],
  ],
  agent: [
    [undefined, ["/dashboard"]],
    ["Servicio", ["/admin/tickets", "/admin/tickets/new"]],
    ["Inventario", ["/admin/refacciones"]],
    ["Compras", ["/admin/compras/requisiciones", "/admin/compras", "/admin/compras/proveedores"]],
    // Nuevo: el ingeniero PIDE viáticos. No los firma; eso exige `administrar`.
    ["Viáticos", ["/admin/viaticos"]],
  ],
  sales: [
    [undefined, ["/dashboard"]],
    ["Ventas", ["/admin/crm", "/admin/pedidos", "/admin/leads", "/admin/crm/prospectos",
                "/admin/crm/contactos", "/admin/crm/actividades"]],
    ["Clientes", ["/admin/clientes", "/admin/contratos"]],
    ["Análisis", ["/admin/crm/informes", "/admin/crm/objetivos"]],
  ],
  admin: [
    [undefined, ["/dashboard"]],
    ["Servicio", ["/admin/tickets", "/admin/tickets/new"]],
    ["Ventas", ["/admin/crm", "/admin/pedidos", "/admin/leads", "/admin/crm/prospectos",
                "/admin/crm/contactos", "/admin/crm/actividades"]],
    ["Clientes", ["/admin/clientes", "/admin/contratos"]],
    ["Inventario", ["/admin/refacciones"]],
    ["Compras", ["/admin/compras/requisiciones", "/admin/compras",
                 "/admin/compras/proveedores", "/admin/compras/cuentas-por-pagar"]],
    // Viáticos va entre Compras y Análisis: cierra el circuito del dinero que
    // sale, y tiene sección propia porque lo gobierna su propio módulo. Ver la
    // nota de `menu.ts` —estuvo dentro de Compras y este probe lo tumbó—.
    ["Viáticos", ["/admin/viaticos"]],
    ["Análisis", ["/admin/rentabilidad", "/admin/crm/informes", "/admin/crm/objetivos"]],
    // La capa: Inteligencia la encabeza y los tableros van dentro. Administración
    // siempre puede crear uno, aunque no haya ninguno todavía. Ver `conTableros`.
    ["Inteligencia", ["/admin/inteligencia", "/admin/dashboard/nuevo"]],
  ],
};
ESPERADO.owner = ESPERADO.admin;

console.log("── el menú de cada rol, sin ajustes, es el de antes ──");
for (const [rol, esperado] of Object.entries(ESPERADO)) {
  // Sin tableros: la sección de tableros ya tiene su propio probe.
  const real = navFor(rol as never, [], undefined)
    .map((g) => [g.section, g.items.map((i) => i.href)] as [string | undefined, string[]]);
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  check(`${rol}: mismo menú, mismo orden`, igual,
        igual ? `${real.length} secciones` : `\n    esperado ${JSON.stringify(esperado)}\n    real     ${JSON.stringify(real)}`);
}

console.log("\n── el ajuste manda sobre el rol, en los dos sentidos ──");
check("se le puede QUITAR Compras a un agente",
  nivelEfectivo("agent", { compras: "ninguno" }, "compras") === "ninguno");
check("y desaparece de su menú",
  !navFor("agent", [], { compras: "ninguno" }).some((g) => g.section === "Compras"));
check("se le puede DAR Cuentas por pagar sin hacerlo administrador",
  nivelEfectivo("agent", { pagar: "administrar" }, "pagar") === "administrar");
check("y le aparece en el menú",
  navFor("agent", [], { pagar: "administrar" })
    .some((g) => g.items.some((i) => i.href === "/admin/compras/cuentas-por-pagar")));
check("lo que NO se ajusta sigue al rol",
  nivelEfectivo("agent", { pagar: "administrar" }, "servicio") === "editar");

/*
  EL CONJUNTO DE DIRECCIONES, APARTE DEL MENÚ.

  El bloque de arriba compara el menú entero: secciones, orden y renglones. Es
  estricto a propósito, y por eso salta cuando algo se MUEVE aunque nadie gane ni
  pierda acceso —pasó al mudar Inteligencia a su propia capa—.

  Esto compara solo QUIÉN LLEGA A DÓNDE, que es la propiedad de seguridad. Si un
  día el menú se reordena entero y esta comprobación sigue en verde, la mudanza
  fue cosmética; si esta falla, alguien ganó o perdió una pantalla.
*/
console.log("\n── el conjunto de direcciones de cada rol ──");
for (const [rol, esperado] of Object.entries(ESPERADO)) {
  const reales = new Set(
    navFor(rol as never, [], {}, false).flatMap((g) => g.items.map((i) => i.href)),
  );
  const previstas = new Set(esperado.flatMap(([, hrefs]) => hrefs));
  const sobran = [...reales].filter((h) => !previstas.has(h));
  const faltan = [...previstas].filter((h) => !reales.has(h));
  check(`${rol}: llega exactamente a las mismas pantallas`,
    sobran.length === 0 && faltan.length === 0,
    sobran.length || faltan.length
      ? `de más: ${sobran.join(", ") || "—"} · de menos: ${faltan.join(", ") || "—"}`
      : `${reales.size} pantallas`);
}

console.log("\n── las rutas exigen lo que deben ──");
check("cuentas por pagar gana a compras por ser más específica",
  exigenciaDe("/admin/compras/cuentas-por-pagar/nueva")?.modulos.join() === "pagar");
check("una orden de compra sigue siendo de Compras",
  exigenciaDe("/admin/compras/nueva")?.modulos.join() === "compras");
check("los informes son de Análisis y no de Ventas",
  exigenciaDe("/admin/crm/informes")?.modulos.join() === "analisis");
check("pero el embudo sí es de Ventas",
  exigenciaDe("/admin/crm")?.modulos.join() === "ventas");
check("el prefijo de idioma no estorba",
  exigenciaDe("/en/admin/rentabilidad")?.modulos.join() === "analisis");
check("el panel no lo gobierna ningún módulo", exigenciaDe("/dashboard") === null);

/*
  LA FICHA DE LA EMPRESA ABRE POR DOS PUERTAS.

  Es un solo registro con dos lecturas —prospecto para Ventas, cliente para
  Servicio—, así que su regla nombra los dos módulos y basta con alcanzar el
  nivel en UNO. La parte que hay que vigilar es la de abajo: que sea una
  disyunción y no una puerta abierta. Quien no tiene ninguno de los dos sigue
  fuera, y ahí es donde un `some` mal escrito se convierte en un `true` fijo.
*/
check("la ficha de la empresa nombra Ventas y Clientes",
  exigenciaDe("/admin/organizaciones/algun-uuid")?.modulos.join() === "ventas,clientes");
check("entra quien lleva la cartera de clientes, aunque no tenga Ventas",
  puedeEntrar("agent", { clientes: "ver" }, "/admin/organizaciones/algun-uuid"));
check("y entra el vendedor, aunque no tenga Clientes",
  puedeEntrar("agent", { ventas: "ver" }, "/admin/organizaciones/algun-uuid"));
check("un agente sin ninguno de los dos NO entra",
  !puedeEntrar("agent", {}, "/admin/organizaciones/algun-uuid"));
check("y un cliente del portal tampoco",
  !puedeEntrar("client", {}, "/admin/organizaciones/algun-uuid"));
check("dar de alta exige escribir, no solo mirar",
  !puedeEntrar("agent", { clientes: "ver" }, "/admin/organizaciones/nueva") &&
    puedeEntrar("agent", { clientes: "editar" }, "/admin/organizaciones/nueva"));
check("y por eso todo el mundo entra al panel",
  puedeEntrar("client", {}, "/dashboard"));

console.log("\n── los niveles son acumulativos ──");
check("quien administra puede editar", alcanza("administrar", "editar"));
check("quien ve no puede editar", !alcanza("ver", "editar"));
check("un vendedor entra a informes", puedeEntrar("sales", {}, "/admin/crm/informes"));
check("y NO a rentabilidad", !puedeEntrar("sales", {}, "/admin/rentabilidad"));
check("un agente NO entra a cuentas por pagar",
  !puedeEntrar("agent", {}, "/admin/compras/cuentas-por-pagar"));
check("ni a configuración", !puedeEntrar("agent", {}, "/admin/configuracion/usuarios"));

console.log("\n── lo que llega de la base se sanea ──");
check("un módulo desconocido se descarta",
  JSON.stringify(ajustesGuardados({ inventado: "ver", compras: "ver" })) === '{"compras":"ver"}');
check("un nivel inventado se descarta",
  JSON.stringify(ajustesGuardados({ compras: "dios" })) === "{}");
check("basura da mapa vacío",
  JSON.stringify(ajustesGuardados("nada")) === "{}" &&
  JSON.stringify(ajustesGuardados(null)) === "{}" &&
  JSON.stringify(ajustesGuardados([1, 2])) === "{}");

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
