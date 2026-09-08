/**
 * Los formularios que EDITAN algo y se quedan en la pantalla.
 *
 * ── LA CLASE DE FALLO QUE ESTO VIGILA ─────────────────────────────────────
 *
 * React 19 resetea un `<form>` cuya `action` es una función. Un campo
 * CONTROLADO no lleva `selected` ni `value` en el HTML —React lo gobierna por
 * la propiedad del nodo—, así que el reseteo lo manda a su primera opción.
 *
 * La corrección tiene que provocar un RENDER. Un efecto que hace
 * `setX(valorDelServidor)` no lo provoca cuando el estado ya vale eso —y ya
 * vale eso, porque lo acaba de elegir la persona—: React descarta la
 * actualización, no vuelve a renderizar y el DOM se queda en la primera opción.
 *
 * Pasó dos veces: el selector de estado del ticket volvía al estado viejo y el
 * de agente asignado volvía a «Sin asignar». Se arreglan igual, con `key` desde
 * la pantalla, que desmonta y vuelve a montar.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-formularios.mts
 */
import { readFileSync } from "node:fs";

let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };

/** Paneles que editan un registro existente y siguen en pantalla al guardar. */
const PANELES = [
  ["estado del ticket", "src/components/portal/status-panel.tsx",
   "src/app/[locale]/[tenant]/(app)/tickets/[id]/page.tsx", "StatusPanel"],
  ["agente asignado", "src/components/portal/assign-panel.tsx",
   "src/app/[locale]/[tenant]/(app)/tickets/[id]/page.tsx", "AssignPanel"],
] as const;

console.log("── la re-sincronización tiene que provocar un render ──");
for (const [nombre, panel, pagina, comp] of PANELES) {
  const src = readFileSync(panel, "utf8");
  const pag = readFileSync(pagina, "utf8");

  // El efecto que no llega: `setX` con el mismo valor no re-renderiza.
  check(`${nombre}: no se re-sincroniza con un efecto`,
    !/useEffect\(\s*\(\)\s*=>\s*set[A-Z]/.test(src));

  // Lo que sí llega: remontar desde la pantalla.
  const re = new RegExp(`<${comp}[\\s\\S]{0,400}?key=\\{`);
  check(`${nombre}: la pantalla lo remonta con key`, re.test(pag));

  check(`${nombre}: el campo está controlado`, /value=\{/.test(src));
}

/*
  LA DISTINCIÓN QUE HACE QUE ESTO NO SE APLIQUE EN TODAS PARTES.

  En un formulario que CREA algo, que el reseteo lo deje vacío es lo CORRECTO:
  acabas de dar de alta un proveedor y quieres capturar el siguiente. El fallo
  solo existe donde el campo tiene que seguir reflejando lo que quedó guardado,
  o sea en los paneles de arriba. Ponerles `key` a los de alta sería arreglar
  algo que no está roto.

  No se comprueba con una aserción porque no hay nada que afirmar: la ausencia
  de `key` en un formulario de alta es correcta y su presencia también lo sería.
  Una comprobación que no puede fallar es ruido, y enseña a ignorar las que sí.
*/

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
