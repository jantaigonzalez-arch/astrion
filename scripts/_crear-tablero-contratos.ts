import "./_env";

/**
 * Crea el tablero de ingreso contratado y lo compone sobre el lienzo.
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_crear-tablero-contratos.ts
 *
 * Idempotente: si el tablero ya existe, solo vuelve a aplicar la composición.
 * Correrlo dos veces no deja dos tableros ni bloques duplicados. Es lo que
 * permite usarlo también para llevar este tablero a otra instalación.
 *
 * ── EL NOMBRE NACE CORTO Y LUEGO CRECE ────────────────────────────────────
 *
 * El slug sale del PRIMER nombre y después no cambia nunca —es la dirección, y
 * alguien la va a pegar en un chat—. Crear directamente con el nombre largo
 * habría dejado la URL `ingreso-contratado-de-quien-viene-y-cuando-cae` para
 * siempre. Así la dirección queda corta y el nombre dice para qué se abre.
 *
 * ── LAS CAJAS CUENTAN CON LAS DOS MONEDAS ─────────────────────────────────
 *
 * `contracts.schedule` y `contracts.revenue` resuelven a DOS bloques cada uno
 * —uno por moneda, ver `contract-insights`— que se apilan dentro de su caja.
 * Por eso llevan el doble de alto que los otros dos.
 */
const SLUG = "ingreso-contratado";
const NOMBRE_CORTO = "Ingreso contratado";
const TITULO = "Ingreso contratado: de quién viene y cuándo cae";

const COMPOSICION = [
  // Arriba lo que se lee primero: cuándo entra el dinero ya firmado, y la
  // caída que hay que salir a cubrir.
  { analysis: "contracts.schedule", caja: { x: 0, y: 0, w: 24, h: 24 } },
  // Debajo, de quién depende ese ingreso, junto a lo que está por vencer.
  { analysis: "contracts.revenue", caja: { x: 0, y: 24, w: 12, h: 24 } },
  { analysis: "clients.expiring", caja: { x: 12, y: 24, w: 12, h: 12 } },
  { analysis: "clients.by-rep", caja: { x: 12, y: 36, w: 12, h: 12 } },
];

async function main() {
  const {
    createDashboard,
    renameDashboard,
    reorderDashboard,
    setDashboardModules,
    dashboardFor,
  } = await import("@/lib/ml/dashboards");

  let slug = SLUG;
  if (await dashboardFor(SLUG)) {
    console.log(`· ya existía: ${slug}`);
  } else {
    const r = await createDashboard(NOMBRE_CORTO);
    if (!r.ok) {
      console.log("✗", r.reason);
      return;
    }
    slug = r.slug;
    console.log(`✓ creado → ${slug}`);
  }

  const t = await renameDashboard(slug, TITULO);
  if (!t.ok) console.log("✗ nombre:", t.reason);

  const r = await reorderDashboard(
    slug,
    COMPOSICION.map((b) => ({ ...b, active: true, viz: null })),
  );
  console.log(r.ok ? "✓ compuesto" : `✗ ${r.reason}`);

  // Sale en Rentabilidad —donde alguien busca esta pregunta— y en Clientes.
  const m = await setDashboardModules(slug, ["rentabilidad", "clientes"]);
  console.log(m.ok ? "✓ sale en rentabilidad + clientes" : `✗ ${m.reason}`);

  const d = await dashboardFor(slug);
  console.log(`\n  ${d?.title}`);
  for (const b of d?.bloques ?? []) {
    const c = b.caja;
    console.log(
      `   ${b.analysis.id.padEnd(22)} ${c.w}x${c.h} @${c.x},${c.y}  ${b.active ? "on" : "off"}`,
    );
  }
  console.log(`\n  → /admin/dashboard/${slug}   (sin publicar: solo lo ves vos)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
