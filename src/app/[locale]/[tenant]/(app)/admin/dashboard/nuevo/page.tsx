import { setRequestLocale } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";
import { puedeEn } from "@/lib/tenancy/context";
import { redirectInTenant } from "@/lib/nav-server";
import { MODULOS } from "@/lib/ml/analyses";
import { NewDashboardForm } from "@/components/portal/new-dashboard-form";

/**
 * Crear un tablero.
 *
 * ── POR QUÉ UNA PANTALLA Y NO UN BOTÓN QUE CREA ────────────────────────────
 *
 * Porque lo único que hace falta para crear uno es el NOMBRE, y el nombre es la
 * decisión entera. Un botón «Nuevo tablero» que crea uno llamado «Tablero 3» y
 * te deja en el compositor pospone esa decisión al final, cuando ya no importa
 * — y así es como se llenan los sistemas de «Copia de tablero (2)».
 *
 * Se pregunta primero, y la respuesta sirve para dos cosas: es el nombre y es
 * la dirección. Ver `createDashboard` sobre por qué el slug se deriva una vez y
 * ya no cambia.
 *
 * El módulo llega por la URL cuando se entra desde el botón de una pantalla que
 * todavía no tiene tablero, para que salga preseleccionado. Es una sugerencia,
 * no una atadura: dónde sale se decide en el compositor y se puede cambiar.
 */
export default async function NuevoTableroPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ modulo?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("analisis", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const { modulo } = await searchParams;
  // Se valida contra el catálogo: viene de la URL, o sea de fuera.
  const sugerido = MODULOS.find((m) => m.id === modulo)?.id ?? null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LayoutDashboard className="size-6 text-primary" /> Nuevo tablero
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ponle un nombre que diga para qué se abre —«Lo que hay que pagar esta
          semana» dice más que «Tablero de pagos»—. Después eliges qué lleva y en
          qué módulos sale.
        </p>
      </div>

      <NewDashboardForm modulo={sugerido} />
    </div>
  );
}
