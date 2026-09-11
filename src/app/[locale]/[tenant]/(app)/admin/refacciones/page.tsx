import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import {
  CAMPOS_REFACCION,
  FILTROS_EXISTENCIA,
  ORDEN_REFACCIONES_DEFECTO,
  contarRefacciones,
  listarRefacciones,
  resumenInventario,
} from "@/lib/data/parts";
import { parseFiltro, parseOrden } from "@/lib/listado";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { getIncomingByPart } from "@/lib/data/purchasing";
import { AddPartForm } from "@/components/portal/part-forms";
import { PartsInventory } from "@/components/portal/parts-inventory";
import { puedeEn } from "@/lib/tenancy/context";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { AnalysisSection, AnalysisSectionSkeleton } from "@/components/portal/analysis-section";
import { BotonDescargar } from "@/components/portal/boton-descargar";

const BASE = "/admin/refacciones";

export default async function SparePartsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    por?: string;
    q?: string;
    marca?: string;
    existencia?: string;
    orden?: string;
    dir?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("inventario", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const sp = await searchParams;
  const pagina = parsePage(sp);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const marca = sp.marca?.trim().slice(0, 80) || undefined;
  const existencia = parseFiltro(sp.existencia, FILTROS_EXISTENCIA);
  const orden = parseOrden(sp, CAMPOS_REFACCION, ORDEN_REFACCIONES_DEFECTO);

  // Las dos mitades de la misma pregunta: qué hay y qué viene en camino. Lo
  // que viene en camino es poco —las órdenes abiertas— y hace falta ANTES solo
  // si se filtra por ello.
  const incomingP = getIncomingByPart();
  const enCamino = existencia === "incoming" ? [...(await incomingP).keys()] : undefined;
  const opciones = { q, marca, existencia, enCamino, orden };
  const [incoming, parts, conteo, resumen] = await Promise.all([
    incomingP,
    listarRefacciones({ ...opciones, limit: pagina.perPage, offset: pagina.offset }),
    contarRefacciones(opciones),
    resumenInventario(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Inventario de refacciones
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Intl.NumberFormat("es-MX").format(resumen.total)} refacciones en el
            catálogo, {new Intl.NumberFormat("es-MX").format(resumen.con)} con piezas en
            almacén.
          </p>
        </div>
        {/* `items-start` y no `items-center` como en los demás: `AddPartForm`
            se despliega en un panel alto, y centrado dejaría el botón de
            descargar flotando a media altura del formulario abierto. */}
        <div className="flex flex-wrap items-start gap-2">
          <BotonDescargar dataset="refacciones" />
          <AddPartForm />
        </div>
      </div>

      <PartsInventory
        parts={parts.map((p) => ({ ...p, incoming: incoming.get(p.id) ?? null }))}
        resumen={{
          ...resumen,
          incoming: incoming.size,
          sobregiros: resumen.sobregiros.map((p) => ({
            ...p,
            incoming: incoming.get(p.id) ?? null,
          })),
        }}
        filtradas={conteo.n}
        valor={conteo.valor}
        q={q}
        marca={marca}
        existencia={existencia}
        orden={orden}
        basePath={BASE}
      />
      <Pagination
        {...pagina}
        total={conteo.n}
        basePath={BASE}
        query={{
          q: q || undefined,
          marca,
          existencia,
          orden: orden.campo,
          dir: orden.dir,
        }}
      />
      {/* Debajo del listado: lo que hay que reponer se decide mirando primero lo
          que hay.

          En `Suspense` para que la pantalla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/refacciones" />
      </Suspense>


      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="refacciones" />
      </Suspense>
    </div>
  );
}
