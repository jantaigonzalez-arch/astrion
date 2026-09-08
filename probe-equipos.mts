/**
 * EL LISTADO DE EQUIPOS DA LO MISMO DESPUÉS DE CAMBIARLE LA FORMA.
 *
 * Los dos conteos pasaron de `left join` + `count(distinct …)` a subconsultas
 * correlacionadas. El número es el mismo por construcción —lo dice el álgebra—
 * y por eso justamente hay que comprobarlo corriéndolo: los cambios que «no
 * pueden fallar» son los que se despliegan sin mirar.
 *
 * Se compara contra la forma VIEJA escrita a mano aquí, no contra una foto de
 * los resultados: una foto solo dice que hoy coinciden, esto dice que coinciden
 * con los datos que haya.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-equipos.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { sql } = await import("drizzle-orm");

const db = tenantDbFor("tenant_evoelution");
let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

type Fila = { id: string; modulos: number; servicios: number };

// La forma de ANTES, tal cual estaba.
const vieja = (await db.execute(sql`
  select e.id::text as id,
         count(distinct em.id)::int as modulos,
         count(distinct t.id)::int  as servicios
    from equipment e
    left join equipment_modules em on em.equipment_id = e.id
    left join tickets t on t.equipment_id = e.id
   group by e.id`)) as unknown as Fila[];

// La de AHORA.
const nueva = (await db.execute(sql`
  select e.id::text as id,
         (select count(*)::int from equipment_modules em where em.equipment_id = e.id) as modulos,
         (select count(*)::int from tickets t where t.equipment_id = e.id) as servicios
    from equipment e`)) as unknown as Fila[];

ok("mismo número de equipos", vieja.length === nueva.length,
   `${vieja.length} vs ${nueva.length}`);

const porId = new Map(nueva.map((f) => [f.id, f]));
const distintos = vieja.filter((v) => {
  const n = porId.get(v.id);
  return !n || n.modulos !== v.modulos || n.servicios !== v.servicios;
});
ok("cada equipo trae los mismos dos conteos", distintos.length === 0,
   distintos.slice(0, 3).map((d) => `${d.id.slice(0, 8)}: ${d.modulos}/${d.servicios} vs ${porId.get(d.id)?.modulos}/${porId.get(d.id)?.servicios}`).join(" · "));

/*
  Y que la comparación pueda fallar de verdad: si las dos consultas devolvieran
  cero filas, los dos asertos de arriba pasarían sin comprobar nada.
*/
ok("hay equipos que comparar", vieja.length > 0, `${vieja.length}`);
ok("y alguno con módulos y servicios de verdad",
   vieja.some((v) => v.modulos > 0 && v.servicios > 0),
   `con módulos: ${vieja.filter((v) => v.modulos > 0).length}, con servicios: ${vieja.filter((v) => v.servicios > 0).length}`);

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
