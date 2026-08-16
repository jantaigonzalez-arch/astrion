import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { labOverview } from "@/lib/ml/lab";
import { catalogView } from "@/lib/ml/catalog";
import { featureValueLabel } from "@/lib/ml/blocks";
import { MlTemplateCard, type TemplateCard } from "@/components/portal/ml-template-card";
import type { ForecastRow } from "@/components/portal/ml-charts";
import { MlTemplateBuilder } from "@/components/portal/ml-template-builder";
import { ChartSkeleton, Skeleton } from "@/components/portal/skeletons";
import { currentRole } from "@/lib/tenancy/context";

/**
 * Laboratorio de ML del ERP.
 *
 * No es un tablero de resultados: es el lugar donde se averigua qué se puede
 * predecir con los datos de ESTA empresa y qué no. Por eso muestra las
 * plantillas rechazadas con el mismo rango que las aprobadas — un catálogo
 * donde todo sale bien no está midiendo nada.
 */

/** Estadísticos de un grupo, tal como los guarda `train()` en el jsonb. */
type GroupStat = { median: number; p25: number; p75: number; n: number };

/**
 * Traduce el modelo guardado a filas que se pueden dibujar.
 *
 * Las claves de grupo son internas —`categoria+marca|mantenimiento|Waters`— y
 * hay que devolverlas al lenguaje del negocio antes de enseñarlas.
 *
 * El orden NO es por número de casos, y esa es la decisión que importa. Los
 * niveles generales de la escalera siempre acumulan más casos que los
 * específicos, así que ordenar por volumen pondría arriba justo los grupos que
 * casi nunca se usan: `predict()` recorre la escalera de lo más específico a lo
 * más general y se queda con el PRIMERO que existe, de modo que un caso que
 * cae en `categoría+marca` jamás llega a `categoría`. Se ordena entonces por
 * posición en la escalera y solo se desempata por casos, que es el orden en el
 * que el sistema de verdad va a responder.
 */
function forecastRows(
  params: Record<string, unknown>,
  featureLabels: Record<string, string>,
  locale: string,
  limit = 6,
): ForecastRow[] {
  const groups = params?.groups as Record<string, GroupStat> | undefined;
  const global = params?.global as GroupStat | undefined;
  const ladder = (params?.ladder as string[][] | undefined) ?? [];
  if (!groups) return [];

  const rank = new Map(ladder.map((level, i) => [level.join("+"), i]));
  // El nivel de cada fila se guarda aparte en vez de viajar dentro de ella:
  // `ForecastRow` es lo que ve la gráfica y no tiene por qué cargar el orden
  // interno de la escalera solo para poder ordenar aquí.
  const levelKey = new Map<ForecastRow, string>();
  const levelOf = (r: ForecastRow) => levelKey.get(r) ?? "";

  const rows: ForecastRow[] = Object.entries(groups)
    .map(([key, g]) => {
      const [levelPart, ...values] = key.split("|");
      // Los valores vienen en el mismo orden que los rasgos del nivel, así que
      // se pueden emparejar para traducir cada uno con SU mapa: la categoría
      // sabe leerse a sí misma, la marca no necesita mapa.
      const keys = levelPart.split("+");
      const row: ForecastRow = {
        label:
          keys
            .map((k, i) => featureValueLabel(k, values[i] ?? "", locale))
            .filter(Boolean)
            .join(" · ") || "—",
        by: keys.map((k) => featureLabels[k] ?? k).join(" + "),
        median: g.median,
        p25: g.p25,
        p75: g.p75,
        n: g.n,
      };
      levelKey.set(row, levelPart);
      return row;
    })
    .sort(
      (a, b) =>
        (rank.get(levelOf(a)) ?? Infinity) - (rank.get(levelOf(b)) ?? Infinity) ||
        b.n - a.n,
    )
    .slice(0, limit);

  // El respaldo va al final SIEMPRE, aunque tenga más casos que nadie: es lo
  // que se responde cuando no hay nada parecido, y leerlo primero daría la
  // impresión contraria a lo que hace el modelo.
  if (global) {
    rows.push({
      label: "Sin casos parecidos",
      by: "Todo el histórico",
      median: global.median,
      p25: global.p25,
      p75: global.p75,
      n: global.n,
      global: true,
    });
  }

  return rows;
}

export default async function MlLabPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  /*
    El catálogo se lee en su propio límite de Suspense.

    Es la pantalla más cara del ERP —cada plantilla evalúa su consulta sobre
    todo el histórico— y la que menos urge: el encabezado, la explicación y el
    constructor de preguntas no dependen de un solo dato de la base y no tienen
    por qué esperarla. La cuenta de "en producción" comparte la MISMA promesa
    que las tarjetas, así que el catálogo se pide una vez.
  */
  const overview = labOverview();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">ML y predicciones</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Cada plantilla es una pregunta del negocio. El laboratorio la entrena
            con tu propio historial, la evalúa contra el futuro y solo la aprueba
            si le gana a la respuesta ingenua <em>y</em> acierta lo suficiente
            para decidir con ella.
          </p>
        </div>
        <Suspense
          fallback={<Skeleton className="h-4 w-32" />}
        >
          <ProductionCount overview={overview} />
        </Suspense>
      </div>

      {/* El constructor va arriba del catálogo, no escondido al final: crear una
          pregunta es la acción principal de esta pantalla, no un extra. */}
      <MlTemplateBuilder catalog={catalogView()} />

      {/* Dónde vive el modelo. No es una nota técnica de adorno: es la tesis
          del producto, y quien administra la empresa debería poder leerla. */}
      <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
        Los modelos se entrenan y se guardan{" "}
        <span className="font-medium text-foreground">dentro del esquema de tu empresa</span>.
        No salen a ningún servicio externo, no se mezclan con los de otras
        empresas y un respaldo de tu base se los lleva consigo. No hay proyecto
        de extracción de datos de por medio: el modelo vive donde vive el dato.
      </div>

      <Suspense
        fallback={
          <div className="grid gap-4">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        }
      >
        <Catalog overview={overview} locale={locale} />
      </Suspense>
    </div>
  );
}

type Overview = Awaited<ReturnType<typeof labOverview>>;

async function ProductionCount({ overview }: { overview: Promise<Overview> }) {
  const rows = await overview;
  const enProduccion = rows.filter(({ models }) =>
    models.some((m) => m.status === "production"),
  ).length;

  return (
    <span className="font-mono text-xs text-muted-foreground">
      {enProduccion} de {rows.length} en producción
    </span>
  );
}

async function Catalog({
  overview,
  locale,
}: {
  overview: Promise<Overview>;
  locale: string;
}) {
  const rows = await overview;

  const cards: TemplateCard[] = rows.map(({ template, readiness, models }) => ({
    id: template.id,
    label: template.label,
    question: template.question,
    unit: template.unit,
    tolerance: template.tolerance,
    toleranceKind: template.toleranceKind,
    builtin: template.builtin,
    samples: readiness.samples,
    enough: readiness.enough,
    hint: readiness.hint,
    from: readiness.from?.toISOString() ?? null,
    to: readiness.to?.toISOString() ?? null,
    models: models.map((m) => {
      const k = m.metrics as Record<string, number>;
      return {
        id: m.id,
        version: m.version,
        status: m.status,
        beatsBaseline: m.beatsBaseline,
        note: m.note,
        trainedAt: m.trainedAt.toISOString(),
        predictions: m.predictions,
        outcomes: m.outcomes,
        mae: Number(k.mae ?? 0),
        baselineMae: Number(k.baselineMae ?? 0),
        meanBaselineMae: Number(k.meanBaselineMae ?? 0),
        improvement: Number(k.improvement ?? 0),
        withinTolerance: Number(k.withinTolerance ?? 0),
        tolerance: Number(k.tolerance ?? 0),
        // Guardado con las métricas del modelo, no leído de la plantilla: si
        // el margen del objetivo cambia después, un modelo viejo tiene que
        // seguir contando sus aciertos como los contó el día que se midió.
        toleranceKind: (m.metrics as { toleranceKind?: "absolute" | "relative" })
          .toleranceKind,
        nTrain: Number(k.nTrain ?? 0),
        nTest: Number(k.nTest ?? 0),
        forecast: forecastRows(m.params, template.featureLabels, locale),
        // Los modelos entrenados antes de que se guardaran los pares no tienen
        // esta clave. La tarjeta lo dice explícitamente en vez de dibujar una
        // gráfica vacía que parecería un fallo.
        points:
          (m.metrics as { points?: Array<[number, number]> }).points ?? [],
        drift: m.drift,
        degraded: m.degraded,
      };
    }),
  }));

  return (
    <div className="grid gap-4">
      {cards.map((c) => (
        <MlTemplateCard key={c.id} t={c} />
      ))}
    </div>
  );
}
