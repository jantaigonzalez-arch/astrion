import { setRequestLocale } from "next-intl/server";
import { Brain, PlugZap } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";
import { catalogo, perfilar, salud } from "@/lib/intelligence/client";
import {
  forecastFor,
  listQuestions,
  modelsFor,
} from "@/lib/intelligence/questions";
import { Card } from "@/components/ui/card";
import {
  IntelligenceQuestionCard,
  type CandidateView,
  type ModelView,
  type QuestionView,
} from "@/components/portal/intelligence-question-card";
import {
  IntelligenceNewQuestion,
  type ModuloOption,
} from "@/components/portal/intelligence-new-question";

/**
 * La capa de inteligencia: donde el usuario CONFIGURA qué quiere que el sistema
 * le responda.
 *
 * La pantalla se organiza por MÓDULO y no por modelo, y esa es toda la
 * diferencia con el laboratorio anterior. Nadie entra al ERP pensando «quiero
 * una regresión»: entra a Refacciones y se pregunta cuánto va a necesitar el mes
 * que viene. El módulo es la puerta; el catálogo, lo que hay detrás.
 *
 * Se DEGRADA. Si el servicio de inteligencia está caído, la pantalla enseña las
 * preguntas ya guardadas y sus modelos —que viven en la base de la empresa— y
 * dice qué no se puede hacer ahora mismo. Lo que no hace es fallar: un motor de
 * modelos caído no puede tumbar una pantalla de administración.
 */
export default async function InteligenciaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const [vivo, cat, preguntas] = await Promise.all([
    salud(),
    catalogo(),
    listQuestions(),
  ]);

  // Las unidades y los mínimos salen del catálogo del servicio, no se guardan
  // en la base: son propiedad de la serie y cambian con el catálogo, no con la
  // pregunta que alguien creó hace tres meses.
  const series = new Map(
    (cat.ok ? cat.value.modulos : []).flatMap((m) => m.series.map((s) => [s.id, s] as const)),
  );

  const vistas: QuestionView[] = await Promise.all(
    preguntas.map(async (q) => {
      const serie = series.get(q.subject);
      const [modelos, pron, perfil] = await Promise.all([
        modelsFor(q.slug),
        forecastFor(q.slug),
        // El perfilado se pide en vivo: es lo que dice cuánta historia hay HOY,
        // que es distinto de la que había cuando se entrenó. Si el servicio no
        // responde, la tarjeta se dibuja sin esa parte.
        perfilar(q.subject),
      ]);

      return {
        slug: q.slug,
        module: q.module,
        label: q.label,
        question: q.question,
        task: q.task,
        horizon: q.horizon,
        grain: q.grain,
        tolerance: q.tolerance,
        toleranceKind: q.toleranceKind,
        algorithm: q.algorithm,
        unit: serie?.unit ?? "",
        readiness: perfil.ok
          ? {
              rows: perfil.value.rows,
              needs: serie?.min_periods ?? 24,
              warnings: perfil.value.warnings,
            }
          : null,
        // La historia real, para que la gráfica tenga frontera. Sin ella la
        // leyenda decía «ocurrido» sobre una gráfica que solo enseñaba lo
        // estimado, y una serie continua invita a leer los primeros puntos como
        // datos — el malentendido más caro que puede producir esta pantalla.
        history: perfil.ok
          ? perfil.value.tail.map((t) => ({ period: t.at, value: t.value }))
          : [],
        models: modelos.map(toModelView),
        forecast: pron.map((f) => ({
          period: f.period,
          value: f.value,
          lower: f.lower,
          upper: f.upper,
          actual: f.actual,
        })),
      };
    }),
  );

  const porModulo = (cat.ok ? cat.value.modulos : []).map((m) => ({
    id: m.id,
    label: m.label,
    preguntas: vistas.filter((v) => v.module === m.id),
  }));
  // Las preguntas de un módulo que el catálogo ya no ofrece siguen existiendo y
  // hay que verlas: si desaparecieran de la pantalla, quedarían entrenándose
  // solas sin que nadie pueda retirarlas.
  const huerfanas = vistas.filter(
    (v) => !porModulo.some((m) => m.id === v.module),
  );

  const opciones: ModuloOption[] = (cat.ok ? cat.value.modulos : []).map((m) => ({
    id: m.id,
    label: m.label,
    series: m.series,
  }));

  const enProduccion = vistas.filter((v) =>
    v.models.some((m) => m.status === "production"),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Brain className="size-6 text-primary" /> Inteligencia
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Configura qué quieres que el sistema te responda en cada módulo. Se
            entrena con tu propio historial, se evalúa contra el futuro, y solo
            se aprueba si le gana a la respuesta ingenua y acierta lo suficiente
            para decidir con ella.
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {enProduccion} de {vistas.length} sirviendo
        </span>
      </div>

      {/* El estado del motor va arriba y a la vista: si está caído, la mitad de
          los botones de esta pantalla no van a funcionar y decirlo antes es
          mejor que dejar que se descubra al pulsarlos. */}
      {!vivo.ok && (
        <Card className="border-warning/40 bg-warning/5 p-4">
          <p className="flex items-start gap-2 text-sm">
            <PlugZap className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              El motor de inteligencia no responde, así que no se puede entrenar
              ni recalcular ahora mismo. Lo que ves abajo son las preguntas y los
              modelos que ya viven en la base de tu empresa, y siguen intactos.
              <span className="mt-1 block font-mono text-xs text-muted-foreground">
                {vivo.reason}
              </span>
            </span>
          </p>
        </Card>
      )}

      <Card className="border-border bg-secondary/30 p-4">
        <p className="text-sm text-muted-foreground">
          Los modelos se entrenan y se guardan{" "}
          <span className="font-medium text-foreground">
            dentro del esquema de tu empresa
          </span>
          . El motor que los calcula no guarda nada: se puede reiniciar o
          reemplazar sin que pierdas un modelo, y un respaldo de tu base se los
          lleva consigo.
        </p>
      </Card>

      {cat.ok && <IntelligenceNewQuestion modulos={opciones} familias={cat.value.familias} />}

      {vistas.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Todavía no hay ninguna pregunta configurada. Empieza por el módulo
            donde trabajas.
          </p>
        </Card>
      )}

      {porModulo
        .filter((m) => m.preguntas.length > 0)
        .map((m) => (
          <section key={m.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {m.label}
            </h2>
            {m.preguntas.map((q) => (
              <IntelligenceQuestionCard key={q.slug} q={q} />
            ))}
          </section>
        ))}

      {huerfanas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sin módulo en el catálogo actual
          </h2>
          {huerfanas.map((q) => (
            <IntelligenceQuestionCard key={q.slug} q={q} />
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * De la fila de `ml_models` a lo que la tarjeta necesita.
 *
 * La tabla de la competencia y los avisos del perfilado se guardaron dentro de
 * `params` y `data_profile` como JSON opaco, así que aquí es donde se
 * desempaquetan — con `?? []` en todo, porque son modelos entrenados por
 * versiones anteriores del servicio y no tienen por qué traer las mismas claves.
 */
function toModelView(m: Awaited<ReturnType<typeof modelsFor>>[number]): ModelView {
  const tabla = m.params.leaderboard;

  return {
    id: m.id,
    version: m.version,
    status: m.status,
    algorithm: m.algorithm,
    note: m.note,
    trainedAt: m.trainedAt.toISOString(),
    metrics: m.metrics as ModelView["metrics"],
    // `Array.isArray` y no un cast: son modelos entrenados por versiones
    // anteriores del servicio y no tienen por qué traer las mismas claves. Un
    // cast confiado aquí rompe la pantalla entera al iterar `undefined`.
    leaderboard: Array.isArray(tabla) ? (tabla as CandidateView[]) : [],
    warnings: ((m.profile ?? {}) as { warnings?: string[] }).warnings ?? [],
    periods: m.forecasts,
    hasBlob: m.hasBlob,
  };
}
