/**
 * DESARMA LOS DOMICILIOS DEL PADRÓN VIEJO.
 *
 * Las 148 direcciones que llegaron de SAE viven en una sola línea separada por
 * comas. Este script las reparte en los campos del nodo `Domicilio` del SAT y
 * —lo más importante— RECUPERA EL CÓDIGO POSTAL, que es el único dato de
 * domicilio que el CFDI 4.0 exige del receptor y que la exportación entregó
 * como número con separador de miles: «4,650» donde dice 04650.
 *
 *   npm run domicilios              ← ensayo, no escribe nada
 *   npm run domicilios -- --aplicar ← escribe
 *   npm run domicilios -- --tenant acme
 *
 * ── ENSAYO POR OMISIÓN, Y NO AL REVÉS ─────────────────────────────────────
 *
 * Porque esto toca 148 fichas de clientes reales de una vez. Sin bandera imprime
 * lo que haría y se va; hay que pedirle explícitamente que escriba.
 *
 * ── NO PISA LO QUE YA ESTÉ CAPTURADO ──────────────────────────────────────
 *
 * Solo rellena las fichas que no tienen NADA estructurado. Una que alguien ya
 * corrigió a mano vale más que cualquier cosa que deduzca este parser, y una
 * segunda corrida no puede deshacer ese trabajo.
 *
 * ── LO QUE NO ENTIENDE, LO DICE ───────────────────────────────────────────
 *
 * Cada dirección que no se puede colocar entera deja incidencia en el reporte,
 * con el nombre de la ficha. Degradar en silencio —`?? null` y a otra cosa— ya
 * metió 633 tickets sin técnico en esta casa; una dirección medio desarmada sin
 * incidencia es una que nadie va a revisar nunca.
 */
import "./_env";
import { eq, isNotNull } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";
import { getDb } from "@/lib/db";
import { tenantSchemas, tenants } from "@/lib/db/platform";
import { crmOrganizations } from "@/lib/db/schema";
import { desarmarDireccion, tieneDomicilio } from "@/lib/domicilio";

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");

/*
  `indexOf` devuelve -1 cuando la bandera no está, y -1 + 1 es 0: sin `--tenant`,
  el «inquilino» pasaba a ser el primer argumento que hubiera. Correr esto con
  `--aplicar` a secas buscaba un inquilino llamado «--aplicar». Salió a la luz
  porque no existe y el script se plantó; con dos inquilinos de nombre parecido
  habría leído el equivocado sin decir nada.
*/
const iTenant = args.indexOf("--tenant");
const slug = iTenant >= 0 ? (args[iTenant + 1] ?? "evoelution") : "evoelution";

async function main() {
  const control = getDb();
  const [inquilino] = await control
    .select({ schemaName: tenantSchemas.schemaName })
    .from(tenants)
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (!inquilino?.schemaName) {
    console.error(`No existe el inquilino «${slug}».`);
    process.exit(1);
  }

  const db = tenantDbFor(inquilino.schemaName);
  const filas = await db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      address: crmOrganizations.address,
      street: crmOrganizations.street,
      postalCode: crmOrganizations.postalCode,
      state: crmOrganizations.state,
      neighborhood: crmOrganizations.neighborhood,
      municipality: crmOrganizations.municipality,
    })
    .from(crmOrganizations)
    .where(isNotNull(crmOrganizations.address));

  console.log(
    `${aplicar ? "APLICANDO" : "ENSAYO (no escribe)"} · inquilino ${slug} · ` +
      `${filas.length} fichas con dirección\n`,
  );

  let escritas = 0;
  let saltadas = 0;
  let conCp = 0;
  const incidencias: string[] = [];

  for (const f of filas) {
    // Ya tiene domicilio estructurado: es de alguien, no de este parser.
    if (tieneDomicilio(f)) {
      saltadas++;
      continue;
    }

    const { domicilio, incidencias: avisos } = desarmarDireccion(f.address);
    if (!tieneDomicilio(domicilio)) {
      incidencias.push(`${f.name}: no se pudo desarmar «${f.address}».`);
      continue;
    }

    if (domicilio.postalCode) conCp++;
    for (const a of avisos) incidencias.push(`${f.name}: ${a}`);

    if (aplicar) {
      await db
        .update(crmOrganizations)
        .set({
          street: domicilio.street,
          extNumber: domicilio.extNumber,
          intNumber: domicilio.intNumber,
          neighborhood: domicilio.neighborhood,
          locality: domicilio.locality,
          municipality: domicilio.municipality,
          state: domicilio.state,
          postalCode: domicilio.postalCode,
          country: domicilio.country,
          addressReference: domicilio.addressReference,
        })
        .where(eq(crmOrganizations.id, f.id));
    }
    escritas++;
  }

  console.log(`  ${escritas} desarmadas${aplicar ? " y guardadas" : ""}`);
  console.log(`  ${conCp} con código postal recuperado`);
  if (saltadas > 0) {
    console.log(`  ${saltadas} saltadas: ya tenían domicilio capturado`);
  }

  if (incidencias.length > 0) {
    console.log(`\n  ${incidencias.length} incidencia(s) que revisar a mano:`);
    for (const i of incidencias) console.log(`    · ${i}`);
  } else {
    console.log("\n  Sin incidencias.");
  }

  if (!aplicar) {
    console.log("\n  Esto fue un ensayo. Con --aplicar se escribe.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
