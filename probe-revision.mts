/**
 * REVISIÓN PREVIA AL DESPLIEGUE.
 *
 * Empareja cada guardia como estaba ANTES con lo que quedó DESPUÉS, sacado del
 * diff, y compara las dos respuestas para los cinco roles. Cualquier casilla que
 * no coincida es alguien que gana o pierde acceso, y hay que poder explicarla
 * una por una antes de tocar producción.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-revision.mts
 */
import { execFileSync } from "node:child_process";
const { isSupport, isSalesRole, isAdminRole, isInternal } = await import("./src/lib/roles.ts");
const { nivelEfectivo, alcanza } = await import("./src/lib/permisos.ts");

const ROLES = ["owner", "admin", "agent", "sales", "client"] as const;
const VIEJO: Record<string, (r: never) => boolean> = {
  isSupport, isSalesRole, isAdminRole, isInternal,
};

/*
  El diff SE SACA DE GIT, no de un archivo suelto en /tmp.

  La primera versión leía `/tmp/guards.txt`, que yo había volcado a mano antes
  del refactor. En cuanto la máquina limpió /tmp, la prueba dejó de correr —y
  una revisión previa al despliegue que se cae por no encontrar su entrada no
  revisa nada—. El commit que cambió las guardias es su fuente de verdad y no
  se va a mover.
*/
const COMMIT = "aaab7a1"; // permisos: el rol deja de ser la única palabra…
const lineas = execFileSync(
  "git",
  ["show", "--unified=0", "--format=", COMMIT, "--", "src/app", "src/components", "src/lib"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
).split("\n");
const pares: Array<{ pred: string; mod: string; niv: string }> = [];
for (let i = 0; i < lineas.length - 1; i++) {
  const a = lineas[i], b = lineas[i + 1];
  if (!a.startsWith("-") || !b.startsWith("+")) continue;
  const p = a.match(/\b(isSupport|isSalesRole|isAdminRole|isInternal)\(/);
  const n = b.match(/puedeEn\("(\w+)", "(\w+)"\)/);
  if (p && n) pares.push({ pred: p[1], mod: n[1], niv: n[2] });
}

// Cada combinación distinta, con cuántas veces aparece.
const combos = new Map<string, number>();
for (const p of pares) {
  const k = `${p.pred}|${p.mod}|${p.niv}`;
  combos.set(k, (combos.get(k) ?? 0) + 1);
}

console.log(`${pares.length} guardias emparejados, ${combos.size} combinaciones distintas\n`);
let iguales = 0, distintos = 0;
const cambios: string[] = [];

for (const [k, veces] of [...combos].sort()) {
  const [pred, mod, niv] = k.split("|");
  const filas = ROLES.map((r) => {
    const antes = VIEJO[pred](r as never);
    const ahora = alcanza(nivelEfectivo(r as never, {}, mod as never), niv as never);
    return { r, antes, ahora };
  });
  const difs = filas.filter((f) => f.antes !== f.ahora);
  if (difs.length === 0) { iguales++; continue; }
  distintos++;
  for (const d of difs) {
    cambios.push(
      `${pred} → ${mod}/${niv}  ·  ${d.r}: ${d.antes ? "PODÍA" : "no podía"} → ${d.ahora ? "PUEDE" : "no puede"}  (×${veces})`,
    );
  }
}

/*
  DOS DIFERENCIAS YA REVISADAS, UNA POR UNA.

  El diff de aquel commit sigue conteniéndolas, así que la prueba las va a
  encontrar siempre. Anotarlas aquí es lo que le permite gritar por lo que
  NO esté en esta lista, que es para lo que existe.
*/
const EXPLICADAS: Record<string, string> = {
  "isAdminRole → clientes/editar  ·  sales: no podía → PUEDE":
    "contratos/nuevo. Ensanchaba el acceso: un vendedor podía abrir contratos. " +
    "Corregido después a clientes/administrar; el código de hoy ya no lo hace.",
  "isInternal → ventas/ver  ·  agent: PODÍA → no puede":
    "El expediente comercial (/admin/crm) deja de estar abierto a soporte. " +
    "Es el cambio buscado, y es reversible por persona desde Configuración " +
    "→ Usuarios sin tocar código.",
};

console.log(`✓ ${iguales} combinaciones se comportan IGUAL para los cinco roles`);
const unicos = [...new Set(cambios)];
const nuevos = unicos.filter((c) => !(c.replace(/\s+\(×\d+\)$/, "") in EXPLICADAS));

if (unicos.length === 0) {
  console.log("✅ ningún rol gana ni pierde acceso");
} else {
  console.log(`\n${distintos} combinaciones cambian de comportamiento:\n`);
  for (const c of unicos) {
    const razon = EXPLICADAS[c.replace(/\s+\(×\d+\)$/, "")];
    console.log(`   ${razon ? "·" : "⚠"} ${c}`);
    if (razon) console.log(`     ${razon}`);
  }
}
console.log(
  nuevos.length === 0
    ? "\n✅ ninguna diferencia sin explicar"
    : `\n⚠ ${nuevos.length} SIN EXPLICAR — revisalas antes de desplegar`,
);
process.exit(nuevos.length === 0 ? 0 : 1);
