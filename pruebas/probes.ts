/**
 * EJECUTAR LOS PROBES QUE YA EXISTEN, SIN REESCRIBIRLOS.
 *
 * ── POR QUÉ ENVOLVER Y NO MIGRAR ───────────────────────────────────────────
 *
 * Hay 53 probes y unas 7 000 líneas. Lo valioso de ellos no es el código: es el
 * criterio. `probe-telefono` corre contra los teléfonos que hay cargados de
 * verdad; `probe-export` comprueba que el tope RECHACE en vez de recortar;
 * `probe-permisos` verifica que un modelo nuevo no le cambie el acceso a nadie.
 * Reescribir eso en la forma de otro marco es semanas de trabajo cuyo mejor
 * resultado posible es quedar como estaba, y cuyo resultado probable es perder
 * matices por el camino.
 *
 * Así que no se migran. Cada probe se ejecuta tal cual, en su propio proceso, y
 * su código de salida es el veredicto. Lo que aporta Vitest es lo que faltaba:
 * que alguien los corra TODOS, que el fallo de uno se vea como una línea roja
 * entre las demás, y que exista un único comando que un flujo de CI pueda
 * invocar.
 *
 * ── LA INVOCACIÓN SALE DEL PROPIO PROBE ────────────────────────────────────
 *
 * Cada uno declara en su cabecera cómo se corre —hay tres `tsconfig` distintos
 * en juego, y algunos necesitan `--conditions react-server` para importar
 * componentes de servidor—. Se lee de ahí en vez de mantener una tabla aparte,
 * por la misma razón que `scripts/tenant.ts` deriva sus tablas de las
 * migraciones: una segunda lista es una lista que se desincroniza, y el síntoma
 * sería un probe corriendo con la configuración equivocada durante meses.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const RAIZ = path.resolve(import.meta.dirname, "..");

/** Todos los probes del repositorio, vengan de donde vengan. */
export function todosLosProbes(): string[] {
  return [
    ...readdirSync(RAIZ)
      .filter((f) => /^probe-.*\.mts$/.test(f))
      .sort(),
    ...readdirSync(path.join(RAIZ, "scripts"))
      .filter((f) => /^_probe-.*\.ts$/.test(f))
      .sort()
      .map((f) => `scripts/${f}`),
  ];
}

/**
 * Cómo se corre un probe, según lo que él mismo dice.
 *
 * Si no lo declara, se usa el valor por omisión de su carpeta. Es lo que pasa
 * con 18 de los 53, escritos antes de que existiera esta convención.
 */
export function invocacion(archivo: string): string {
  const lineas = readFileSync(path.join(RAIZ, archivo), "utf8")
    .slice(0, 4000)
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim());

  /*
    Se recorre línea a línea en vez de con una expresión sobre todo el texto.

    Varias cabeceras parten la orden en dos con una barra al final:

        npx tsx --tsconfig tsconfig.probe.json \
          scripts/_probe-arch.ts

    Con una expresión regular sobre el texto entero, la parte que recorre la
    primera línea se traga también esa barra y la continuación nunca se une: el
    resultado era `npx tsx \`, una orden sin archivo que habría corrido en vacío
    y dado verde. Lo encontró la prueba de este mismo archivo.
  */
  const i = lineas.findIndex((l) => /^(?:[A-Z_]+=\S+\s+)*npx tsx\b/.test(l));
  if (i >= 0) {
    const partes: string[] = [];
    for (let j = i; j < lineas.length; j++) {
      const sigue = lineas[j].endsWith("\\");
      partes.push(lineas[j].replace(/\\$/, "").trim());
      if (!sigue) break;
    }
    return partes.join(" ").replace(/\s+/g, " ").trim();
  }

  return archivo.startsWith("scripts/")
    ? `npx tsx --tsconfig tsconfig.scripts.json ${archivo}`
    : `npx tsx --tsconfig tsconfig.check.json ${archivo}`;
}

export type Resultado = { ok: boolean; salida: string; fallos: number };

/**
 * Corre un probe y devuelve su veredicto.
 *
 * El código de salida manda, no el texto: un probe que revienta al importar
 * —una ruta que ya no existe, una tabla renombrada— no imprime ni un solo `✗`,
 * y contar marcas lo daría por bueno. Es exactamente el fallo que más importa
 * detectar, porque significa que la prueba lleva tiempo sin probar nada.
 */
export function correr(archivo: string): Resultado {
  const cmd = invocacion(archivo);
  try {
    const salida = execFileSync("bash", ["-c", cmd], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, salida, fallos: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const salida = String(err.stdout ?? "") + String(err.stderr ?? "");
    return { ok: false, salida, fallos: (salida.match(/^✗/gm) ?? []).length };
  }
}

/**
 * Lo que hay que leer cuando un probe se pone rojo.
 *
 * ── POR QUÉ NO ES SOLO LA COLA ─────────────────────────────────────────────
 *
 * La primera versión devolvía las últimas doce líneas, y eso cortaba justo lo
 * único que importaba. Cuando diez probes murieron en Actions por un módulo que
 * faltaba, el registro mostró doce líneas de pila de tsx y NO la línea que decía
 * qué módulo era: iba arriba del todo. Hubo que reproducirlo a mano para
 * averiguar lo que el propio fallo ya había dicho.
 *
 * Así que se busca la línea que nombra el error, y solo si no la hay se cae a
 * la cola. Un mensaje de fallo que obliga a reproducir el fallo no sirve de nada.
 */
export function resumenDeFallo(r: Resultado): string {
  const lineas = r.salida.split("\n").filter((l) => l.trim());

  const marcas = lineas.filter((l) => l.trimStart().startsWith("✗"));
  if (marcas.length) return "\n" + marcas.slice(0, 12).join("\n");

  // Sin marcas es que reventó: lo que explica el reventón es la primera línea
  // que nombra el error, no la última de la pila.
  const causa = lineas.filter((l) =>
    /Cannot find module|MODULE_NOT_FOUND|^\s*(Error|TypeError|SyntaxError|AssertionError)\b|error:/i.test(l),
  );
  if (causa.length) return "\n" + causa.slice(0, 6).join("\n") + "\n…\n" + lineas.slice(-4).join("\n");

  return "\n" + lineas.slice(-12).join("\n");
}
