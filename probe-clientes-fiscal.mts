/**
 * LOS CRITERIOS DE ACEPTACIÓN DEL CATÁLOGO DE CLIENTES, EJECUTABLES.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-clientes-fiscal.mts
 *
 * ── QUÉ SE ESTÁ PROBANDO ───────────────────────────────────────────────────
 *
 * Las reglas que hacen que un cliente se pueda timbrar sin que el PAC lo
 * rechace. Sin base de datos: los catálogos del SAT entran como parámetro, que
 * es justo por lo que `validarExpediente` los recibe en vez de leerlos. Una
 * regla fiscal que solo se puede probar levantando Postgres es una regla que
 * nadie prueba.
 *
 * ── LA TERCERA RESPUESTA ───────────────────────────────────────────────────
 *
 * Buena parte de lo que sigue no comprueba «acepta» o «rechaza», sino que
 * distinga NO VERIFICABLE de las dos. Sin catálogo cargado, el régimen 999 no
 * es inválido: es incomprobable, y decir lo contrario sería inventar un
 * veredicto. Esa distinción es la mitad del valor del módulo y por eso tiene
 * sección propia.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  validarRfc,
  normalizarNombreFiscal,
  digitoVerificadorRfc,
} from "./src/lib/domain/fiscal.ts";
import {
  validarExpediente,
  hashExpediente,
  validacionVigente,
  SIN_CATALOGOS,
  type CatalogosSat,
} from "./src/lib/domain/cliente.ts";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

/**
 * Un catálogo DE MENTIRA, y dice que lo es.
 *
 * No es el catálogo del SAT ni pretende serlo: son cuatro regímenes y tres usos
 * con la forma correcta, para poder ejercitar las reglas que los cruzan. El
 * catálogo de verdad se carga con `npm run sat:catalogos` desde los archivos
 * oficiales, y ninguna decisión de timbrado sale de este archivo.
 *
 * Los pares uso↔régimen de aquí abajo reproducen dos hechos conocidos del
 * catálogo real —que `D01` es solo de personas físicas y que `CN01` es solo del
 * 605— porque son los dos ejemplos que pide el criterio de aceptación. Si el
 * SAT los cambiara, lo que hay que actualizar es el catálogo, no este probe.
 */
const CAT: CatalogosSat = {
  regimenes: new Map([
    ["601", { aplicaFisica: false, aplicaMoral: true }],
    ["605", { aplicaFisica: true, aplicaMoral: false }],
    ["612", { aplicaFisica: true, aplicaMoral: false }],
    ["616", { aplicaFisica: true, aplicaMoral: true }],
  ]),
  usos: new Map([
    ["G01", { aplicaFisica: true, aplicaMoral: true }],
    ["G03", { aplicaFisica: true, aplicaMoral: true }],
    ["D01", { aplicaFisica: true, aplicaMoral: false }],
    ["S01", { aplicaFisica: true, aplicaMoral: true }],
    ["CN01", { aplicaFisica: true, aplicaMoral: false }],
  ]),
  usoRegimen: new Set([
    "G01|601", "G01|612", "G01|616",
    "G03|601", "G03|612", "G03|616",
    "D01|612",
    "S01|616", "S01|601", "S01|612",
    "CN01|605",
  ]),
  cpExiste: (cp) => ["64000", "64460", "01000", "44100"].includes(cp),
};

/*
  EL DÍGITO VERIFICADOR SE CALCULA, NO SE ESCRIBE.

  La primera versión de este probe traía un RFC inventado a mano —«AAA010101AA4»—
  y el 4 estaba mal. Lo delató el único caso que comprobaba `ok` en vez de buscar
  un código concreto: la sucursal, que falló por un motivo que no tenía nada que
  ver con sucursales. Los demás pasaban porque preguntaban «¿está el error X?» y
  el error X estaba, acompañado de otro que nadie miraba.

  Es la lección de siempre en este repositorio: una aserción que se cumple por
  una razón que no es la que dice, no prueba nada. Ahora el dígito sale del
  algoritmo, así que el RFC de las pruebas es válido por construcción.
*/
const conDigito = (sinDigito: string) => sinDigito + digitoVerificadorRfc(sinDigito + "0")!;

const moral = conDigito("AAA010101AA");
const fisica = conDigito("AAAA010101AA");

/** Un expediente que pasa, para partir de él y romper una cosa cada vez. */
const BASE = {
  rolFiscal: "normal" as const,
  rfc: moral,
  nombre: "Comercializadora Ejemplo, S.A. de C.V.",
  regimenFiscal: "601",
  cpFiscal: "64000",
};

/* ── 1 · RFC ────────────────────────────────────────────────────────────── */
console.log("\nRFC: FORMA, FECHA Y DÍGITO VERIFICADOR");

ok(`un RFC moral de 12 se acepta y se lee como moral`, (() => {
  const v = validarRfc(moral);
  return v.ok && v.tipo === "moral";
})(), moral);

ok(`uno de 13 se acepta y se lee como física`, (() => {
  const v = validarRfc(fisica);
  return v.ok && v.tipo === "fisica";
})(), fisica);

ok(
  "el tipo de persona NO se pregunta: sale de la longitud",
  validarRfc(moral).tipo !== validarRfc(fisica).tipo,
);

ok(
  "un RFC con mes 13 se rechaza por fecha",
  validarRfc("AAA011301AAA").errores.includes("rfc_fecha_invalida"),
);
ok(
  "un RFC con día 32 se rechaza por fecha",
  validarRfc("AAA010132AAA").errores.includes("rfc_fecha_invalida"),
);
ok(
  "un dígito verificador que no cuadra se rechaza",
  validarRfc(moral.slice(0, -1) + (moral.slice(-1) === "1" ? "2" : "1")).errores.includes(
    "rfc_digito_verificador",
  ),
);
ok("los espacios y guiones del padrón viejo no estorban", validarRfc(`${moral.slice(0,3)}-${moral.slice(3,9)}-${moral.slice(9)}`).ok);

/* ── 2 · Nombre fiscal ──────────────────────────────────────────────────── */
console.log("\nNOMBRE FISCAL: LO QUE SE TIMBRA NO ES LO QUE SE TECLEA");

const n1 = normalizarNombreFiscal("Comercializadora Ejemplo, S.A. de C.V.");
ok(
  "«Comercializadora Ejemplo, S.A. de C.V.» → «COMERCIALIZADORA EJEMPLO»",
  n1.normalizado === "COMERCIALIZADORA EJEMPLO",
  n1.normalizado,
);
ok("y se recuerda qué se quitó, para poder explicarlo", n1.regimenRemovido === "S.A. DE C.V.");
ok(
  "se conserva lo tecleado, intacto",
  n1.capturado === "Comercializadora Ejemplo, S.A. de C.V.",
);

for (const [entrada, esperado] of [
  ["Servicios Analíticos del Norte, S. de R.L. de C.V.", "SERVICIOS ANALÍTICOS DEL NORTE"],
  ["Laboratorios Muñoz SAPI de CV", "LABORATORIOS MUÑOZ"],
  ["Instituto Ñuñez A.C.", "INSTITUTO ÑUÑEZ"],
  ["  Grupo   Ejemplo   SA DE CV ", "GRUPO EJEMPLO"],
] as const) {
  const r = normalizarNombreFiscal(entrada);
  ok(`«${entrada.trim().slice(0, 34)}…» → «${esperado}»`, r.normalizado === esperado, r.normalizado);
}

ok(
  "los acentos y la Ñ SE CONSERVAN: el padrón los tiene",
  normalizarNombreFiscal("Juan Pérez Ñandú").normalizado === "JUAN PÉREZ ÑANDÚ",
);
ok(
  "un nombre que es SOLO régimen de capital no se vacía",
  normalizarNombreFiscal("SA DE CV").normalizado === "SA DE CV",
);

/* ── 3 · Uso de CFDI contra régimen (CFDI40158) ─────────────────────────── */
console.log("\nUSO ↔ RÉGIMEN: LA MATRIZ QUE EVITA EL CFDI40158");

const conUso = (regimen: string, uso: string, rfc = moral) =>
  validarExpediente({ ...BASE, rfc, regimenFiscal: regimen, usoCfdiDefault: uso }, CAT);

ok(
  "con régimen 601, el uso D01 se rechaza con el código del SAT",
  conUso("601", "D01").errores.some((e) => e.codigo === "CFDI40158"),
);
ok(
  "con régimen 601, el uso G01 se acepta",
  !conUso("601", "G01").errores.some((e) => e.codigo === "CFDI40158"),
);
ok(
  "con régimen 605, el uso G01 se rechaza",
  conUso("605", "G01", fisica).errores.some((e) => e.codigo === "CFDI40158"),
);
ok(
  "con régimen 605, CN01 se acepta",
  !conUso("605", "CN01", fisica).errores.some((e) => e.codigo === "CFDI40158"),
);

/* ── 4 · Régimen contra tipo de persona (CFDI40149) ─────────────────────── */
console.log("\nRÉGIMEN ↔ TIPO DE PERSONA");

ok(
  "un RFC de persona moral con régimen 605 (solo física) se rechaza",
  validarExpediente({ ...BASE, rfc: moral, regimenFiscal: "605" }, CAT).errores.some(
    (e) => e.codigo === "CFDI40149",
  ),
);
ok(
  "un RFC de persona física con régimen 601 (solo moral) se rechaza",
  validarExpediente({ ...BASE, rfc: fisica, regimenFiscal: "601" }, CAT).errores.some(
    (e) => e.codigo === "CFDI40149",
  ),
);
ok(
  "el 616 aplica a las dos y no estorba a ninguna",
  validarExpediente({ ...BASE, rfc: moral, regimenFiscal: "616" }, CAT).ok &&
    validarExpediente({ ...BASE, rfc: fisica, regimenFiscal: "616" }, CAT).ok,
);

/* ── 5 · Código postal ──────────────────────────────────────────────────── */
console.log("\nCÓDIGO POSTAL FISCAL");

ok(
  "un CP que no está en el catálogo se rechaza con CFDI40148",
  validarExpediente({ ...BASE, cpFiscal: "99999" }, CAT).errores.some(
    (e) => e.codigo === "CFDI40148",
  ),
);
ok(
  "uno que no son cinco dígitos, también",
  validarExpediente({ ...BASE, cpFiscal: "640" }, CAT).errores.some(
    (e) => e.codigo === "CFDI40148",
  ),
);

/* ── 6 · LA TERCERA RESPUESTA: no verificable ───────────────────────────── */
console.log("\nSIN CATÁLOGOS CARGADOS: NO ES VÁLIDO NI INVÁLIDO, ES INCOMPROBABLE");

const sinCat = validarExpediente({ ...BASE, regimenFiscal: "999", cpFiscal: "99999" }, SIN_CATALOGOS);
ok(
  "un régimen inexistente NO se declara inválido si no hay catálogo",
  !sinCat.errores.some((e) => e.campo === "regimen_fiscal"),
);
ok(
  "…se ADVIERTE que no se pudo comprobar",
  sinCat.advertencias.some(
    (e) => e.campo === "regimen_fiscal" && e.codigo === "catalogo_no_cargado",
  ),
);
ok(
  "lo mismo con el código postal",
  sinCat.advertencias.some((e) => e.campo === "cp_fiscal" && e.codigo === "catalogo_no_cargado"),
);
ok(
  "y con catálogo cargado, los mismos datos SÍ son errores",
  validarExpediente({ ...BASE, regimenFiscal: "999", cpFiscal: "99999" }, CAT).errores.length >= 2,
);
ok(
  "el nombre queda advertido SIEMPRE: solo el SAT lo confirma",
  validarExpediente(BASE, CAT).advertencias.some((e) => e.codigo === "CFDI40147"),
);

/* ── 7 · Público en general y extranjeros ───────────────────────────────── */
console.log("\nLOS DOS RECEPTORES QUE NO ESTÁN EN EL PADRÓN");

ok(
  "el público en general con su RFC genérico y su nombre literal, pasa",
  validarExpediente(
    {
      rolFiscal: "publico_general",
      rfc: "XAXX010101000",
      nombre: "PUBLICO EN GENERAL",
      regimenFiscal: "616",
      cpFiscal: "64000",
      usoCfdiDefault: "S01",
    },
    CAT,
  ).ok,
);
ok(
  "…y con otro nombre, se rechaza con CFDI40147",
  validarExpediente(
    {
      rolFiscal: "publico_general",
      rfc: "XAXX010101000",
      nombre: "Público en General S.A. de C.V.",
      regimenFiscal: "616",
      cpFiscal: "64000",
    },
    CAT,
  ).errores.some((e) => e.codigo === "CFDI40147"),
);
ok(
  "un cliente NORMAL con RFC genérico se rechaza: es un rol mal puesto",
  validarExpediente({ ...BASE, rfc: "XAXX010101000" }, CAT).errores.some(
    (e) => e.codigo === "rol_normal_con_rfc_generico",
  ),
);

const extranjeroBase = {
  rolFiscal: "extranjero" as const,
  rfc: "XEXX010101000",
  nombre: "ACME INSTRUMENTS INC",
  regimenFiscal: "616",
  cpFiscal: "64000",
  paisResidencia: "USA",
};

ok(
  "un extranjero SIN número de registro tributario no se puede guardar",
  validarExpediente(extranjeroBase, CAT).errores.some(
    (e) => e.codigo === "extranjero_sin_num_reg_id_trib",
  ),
);
ok(
  "con él, sí",
  validarExpediente({ ...extranjeroBase, numRegIdTrib: "98-7654321" }, CAT).ok,
);
ok(
  "un extranjero que dice residir en MEX se rechaza",
  validarExpediente(
    { ...extranjeroBase, paisResidencia: "MEX", numRegIdTrib: "98-7654321" },
    CAT,
  ).errores.some((e) => e.codigo === "extranjero_pais_mex"),
);
ok(
  "y un RFC mexicano con país extranjero, también",
  validarExpediente({ ...BASE, paisResidencia: "USA" }, CAT).errores.some(
    (e) => e.codigo === "pais_incoherente",
  ),
);

/* ── 8 · Matriz y sucursal ──────────────────────────────────────────────── */
console.log("\nLA SUCURSAL NO TIENE DOMICILIO FISCAL PROPIO");

const sucursal = validarExpediente(
  { ...BASE, cpFiscal: "44100", matriz: { cpFiscal: "64460" } },
  CAT,
);
ok("la sucursal hereda el CP fiscal de la matriz", sucursal.normalizado?.cpFiscal === "64460");
ok(
  "…y se avisa de que su propio CP no se timbrará",
  sucursal.advertencias.some((e) => e.codigo === "cp_heredado_de_matriz"),
);

/* ── 9 · La validación caduca sola ──────────────────────────────────────── */
console.log("\nUN «VÁLIDO» VIEJO SOBRE DATOS NUEVOS NO VALE");

const datos = {
  rfc: moral,
  nombreFiscal: "COMERCIALIZADORA EJEMPLO",
  cpFiscal: "64000",
  regimenFiscal: "601",
};
const guardado = { hashDatos: hashExpediente(datos), resultado: "valido" };

ok("mientras nada cambie, el veredicto vale", validacionVigente(guardado, datos));
ok(
  "si cambia el NOMBRE, deja de valer",
  !validacionVigente(guardado, { ...datos, nombreFiscal: "COMERCIALIZADORA EJEMPLO DOS" }),
);
ok(
  "si cambia el RFC, deja de valer",
  !validacionVigente(guardado, { ...datos, rfc: conDigito("AAA010102AA") }),
);
ok("si cambia el CP, deja de valer", !validacionVigente(guardado, { ...datos, cpFiscal: "64460" }));
ok(
  "si cambia el RÉGIMEN, deja de valer",
  !validacionVigente(guardado, { ...datos, regimenFiscal: "612" }),
);
ok(
  "un cambio cosmético (espacios, minúsculas) NO lo invalida",
  validacionVigente(guardado, { ...datos, nombreFiscal: "  comercializadora   ejemplo " }),
);
ok(
  "y sin haber validado nunca, nada vale",
  !validacionVigente({ hashDatos: null, resultado: "no_validado" }, datos),
);

/* ── 10 · Los dos domicilios no se cruzan ───────────────────────────────── */
console.log("\nEL CP DE ENTREGA NUNCA ALIMENTA EL QUE SE TIMBRA");

/*
  HAY DOS DOMICILIOS Y SE PARECEN DEMASIADO.

    crm_organizations.*        dónde se OPERA: a dónde viaja el técnico
    cliente_domicilio(fiscal)  el de la CONSTANCIA: lo que se timbra

  Los dos tienen calle, colonia, municipio, estado y código postal. La única
  diferencia está en para qué sirven, y esa clase de diferencia se pierde en
  cuanto alguien tiene prisa: coger `org.postalCode` para rellenar `cpFiscal`
  parece un atajo razonable y produce el rechazo CFDI40148.

  Hasta hace poco el propio comentario del esquema llamaba «domicilio fiscal» al
  operativo, así que la confusión no era hipotética: estaba escrita.

  Se comprueba leyendo el fuente, sin base de datos: lo que se prohíbe es que el
  módulo que guarda el expediente conozca siquiera la tabla de organizaciones.
*/
const accion = readFileSync("src/lib/actions/clientes.ts", "utf8");

ok(
  "quien guarda el expediente no importa `crmOrganizations`",
  !/crmOrganizations/.test(accion),
  "el CP fiscal debe salir de lo validado, nunca de la ficha comercial",
);
ok(
  "y el CP del domicilio fiscal sale de lo validado, no del formulario",
  /cp:\s*n\.cpFiscal/.test(accion),
  "sin esto, un `cp` suelto en el envío separaría los dos",
);

/*
  Y en todo `src/`: nadie asigna un campo fiscal desde uno operativo. Se buscan
  las dos formas en que se escribiría el atajo.
*/
const fuentes: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const ruta = `${d}/${e}`;
    if (statSync(ruta).isDirectory()) {
      if (e !== "node_modules") walk(ruta);
      continue;
    }
    if (/\.tsx?$/.test(e)) fuentes.push(ruta);
  }
})("src");

const cruces = fuentes.filter((f) => {
  const t = readFileSync(f, "utf8");
  return /cpFiscal\s*[:=][^,;\n]*postalCode/.test(t) || /cp_fiscal[^,;\n]*postal_code/.test(t);
});

ok(
  "ningún archivo asigna el CP fiscal desde el CP operativo",
  cruces.length === 0,
  cruces.join(", "),
);

console.log(
  fallos
    ? `\n❌ ${fallos} comprobación(es) fallaron\n`
    : "\n✅ el expediente fiscal cumple los criterios de aceptación\n",
);
process.exit(fallos ? 1 : 0);
