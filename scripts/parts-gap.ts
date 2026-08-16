/**
 * Qué le falta al catálogo de refacciones para que la recomendación de compra
 * sea posible.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/parts-gap.ts
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/parts-gap.ts --csv > faltantes.csv
 *
 * NO da de alta nada. Un número de parte anotado en un reporte de servicio no
 * trae precio, ni proveedor, ni existencias, y esas tres cosas no se pueden
 * inventar: inventarlas produciría un catálogo que parece completo y miente en
 * cada cifra que alimente. Lo que este script hace es poner sobre la mesa qué
 * hay que decidir, ordenado por cuánto duele no tenerlo.
 */
import "./_env";
import { sql } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";

const SCHEMA = process.argv[2]?.startsWith("tenant_")
  ? process.argv[2]
  : "tenant_evoelution";
const CSV = process.argv.includes("--csv");

type Fila = {
  part_number: string;
  descripcion: string;
  consumos: number;
  piezas: number;
  meses: number;
  primer_uso: string;
  ultimo_uso: string;
  en_catalogo: boolean;
  proveedor: string | null;
};

async function main() {
  const db = tenantDbFor(SCHEMA);

  const rows = (await db.execute(sql`
    select p.part_number,
           -- La descripción se copió al consumir, así que puede variar entre
           -- reportes. Se toma la más reciente: es la que el técnico usó al
           -- final, y suele ser la más correcta.
           (array_agg(p.description order by c.created_at desc))[1] as descripcion,
           count(*)::int                                            as consumos,
           sum(p.quantity)::int                                     as piezas,
           count(distinct date_trunc('month', c.created_at))::int   as meses,
           min(c.created_at)::date::text                            as primer_uso,
           max(c.created_at)::date::text                            as ultimo_uso,
           exists (select 1 from spare_parts sp
                    where sp.part_number = p.part_number)           as en_catalogo,
           (select s.name
              from purchase_order_lines pl
              join purchase_orders po on po.id = pl.order_id
              join suppliers s on s.id = po.supplier_id
             where pl.part_number = p.part_number
             group by s.name order by count(*) desc, s.name limit 1) as proveedor
      from ticket_comment_parts p
      join ticket_comments c on c.id = p.comment_id
     where p.part_number <> ''
     group by p.part_number
     order by count(*) desc
  `)) as unknown as Fila[];

  const faltantes = rows.filter((r) => !r.en_catalogo);

  if (CSV) {
    console.log("numero_de_parte,descripcion,consumos,piezas,meses_con_uso,primer_uso,ultimo_uso,proveedor_conocido");
    for (const r of faltantes) {
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      console.log([r.part_number, r.descripcion, r.consumos, r.piezas, r.meses,
        r.primer_uso, r.ultimo_uso, r.proveedor ?? ""].map(esc).join(","));
    }
    return;
  }

  const total = rows.length;
  const enCat = rows.length - faltantes.length;
  const consumosTotal = rows.reduce((a, r) => a + r.consumos, 0);
  const consumosCubiertos = rows.filter((r) => r.en_catalogo).reduce((a, r) => a + r.consumos, 0);

  console.log(`Catálogo de refacciones — ${SCHEMA}\n`);
  console.log(`  números de parte que se consumen : ${total}`);
  console.log(`  de ésos, en el catálogo          : ${enCat}  (${((enCat / total) * 100).toFixed(0)} %)`);
  console.log(`  consumos cubiertos por el catálogo: ${consumosCubiertos} de ${consumosTotal}` +
    `  (${((consumosCubiertos / consumosTotal) * 100).toFixed(0)} %)`);

  // El corte de los 12 meses no es decorativo: una pieza que no se usa desde
  // hace más de un año probablemente salió del parque instalado, y darla de
  // alta hoy llena el catálogo de cosas que nadie va a reponer.
  const hace12 = new Date();
  hace12.setMonth(hace12.getMonth() - 12);
  const vivas = faltantes.filter((r) => new Date(r.ultimo_uso) >= hace12);

  console.log(`\n  faltantes con uso en los últimos 12 meses: ${vivas.length} de ${faltantes.length}`);
  console.log(`  (el resto se usó por última vez hace más de un año: probablemente`);
  console.log(`   ya no están en el parque instalado y no vale la pena darlas de alta)\n`);

  console.log("  Las que más duele no tener, por consumo:\n");
  console.log(
    "    " + "número".padEnd(14) + "usos".padStart(5) + "meses".padStart(7) +
    "  último uso".padEnd(14) + "  proveedor conocido",
  );
  for (const r of vivas.slice(0, 15)) {
    console.log(
      "    " + r.part_number.padEnd(14) +
      String(r.consumos).padStart(5) + String(r.meses).padStart(7) +
      "  " + r.ultimo_uso.padEnd(12) +
      "  " + (r.proveedor ?? "—"),
    );
  }

  console.log(
    `\n  Para dar de alta una hacen falta tres datos que el reporte de servicio\n` +
    `  no trae: existencias actuales, costo y proveedor. Con --csv sale la lista\n` +
    `  completa de ${faltantes.length} para llenarla y volver a importar.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
