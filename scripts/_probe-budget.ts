import "./_env";
import { resolveAnalysis, ANALYSIS_BUDGET_MS, type Analysis } from "../src/lib/ml/analyses";

/** Que un análisis lento no pueda decidir cuánto tarda la pantalla. */
const lento: Analysis = {
  id: "prueba.lento", label: "Uno que se cuelga", watching: [], kind: "finding",
  defaultOn: [],
  resolve: () => new Promise((r) => setTimeout(() => r([]), 30_000)),
};
const roto: Analysis = {
  id: "prueba.roto", label: "Uno que revienta", watching: [], kind: "finding",
  defaultOn: [],
  resolve: async () => { throw new Error("la consulta falló"); },
};
const rapido: Analysis = {
  id: "prueba.rapido", label: "Uno sano", watching: [], kind: "finding",
  defaultOn: [],
  resolve: async () => [{ kind: "finding", insight: { id: "x", headline: "ok", because: "ok", tone: "neutral", support: null } }],
};

async function main() {
  console.log(`presupuesto: ${ANALYSIS_BUDGET_MS} ms\n`);

  const t0 = Date.now();
  const r = await Promise.allSettled([
    resolveAnalysis(lento, {}),
    resolveAnalysis(roto, {}),
    resolveAnalysis(rapido, {}),
  ]);
  const ms = Date.now() - t0;

  console.log(`  lento  → ${r[0].status} ${r[0].status === "fulfilled" ? `${r[0].value.length} bloques (se omitió)` : ""}`);
  console.log(`  roto   → ${r[1].status} ${r[1].status === "rejected" ? "(el error sube, quien llama lo registra)" : ""}`);
  console.log(`  sano   → ${r[2].status} ${r[2].status === "fulfilled" ? `${r[2].value.length} bloque` : ""}`);
  console.log(`\n  la pantalla esperó ${ms} ms, no 30 000 → ${ms < 2500 ? "✓" : "✗"}`);
  // Si el temporizador no se limpiara, el proceso quedaría vivo 30 s más.
  console.log(`  salgo de inmediato: si el temporizador quedara suelto, esto colgaría`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
