import { Sparkles } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { scopeFor } from "@/lib/ml/assistant";
import { BLOCK_LABEL, BLOCK_ORDER, type Block } from "@/lib/ml/blocks-types";
import { InsightItem } from "@/components/portal/insight-strip";
import {
  ForecastCard,
  ProjectionCard,
  TrendCard,
} from "@/components/portal/assistant-blocks";

/**
 * Los análisis de una pantalla, DENTRO de la pantalla.
 *
 * ── POR QUÉ HACÍA FALTA ────────────────────────────────────────────────────
 *
 * Hasta aquí los análisis solo se veían pulsando «Análisis» en la barra
 * superior. Eso funciona para quien ya sabe que ese botón existe y que hoy tiene
 * algo dentro — y no funciona para nadie más. Un pronóstico que hay que ir a
 * buscar no cambia ninguna decisión: quien entra al Embudo a mirar cómo va el
 * mes no va a pulsar un botón por si acaso.
 *
 * El botón se queda: sirve para consultar de paso, desde cualquier pantalla, sin
 * perder lo que se estaba haciendo. Esto es lo contrario y por eso convive —
 * lo que la pantalla afirma por sí sola, sin que nadie lo pida.
 *
 * ── NO RETRASA LA PÁGINA ───────────────────────────────────────────────────
 *
 * Va dentro de un `Suspense` puesto por quien lo usa, así que la pantalla se
 * pinta y el análisis llega después por streaming. Es la misma garantía que ya
 * tenía el asistente —que resolvía en su propia petición— conseguida por el
 * camino del servidor, sin un viaje extra de red.
 *
 * Y hereda las otras dos de `scopeFor`: cada resolutor corre aislado y con
 * presupuesto de tiempo, así que uno lento o roto se queda fuera y la sección
 * sale con el resto. El análisis nunca puede ser la razón por la que alguien no
 * puede trabajar.
 *
 * ── CUÁNDO NO SE DIBUJA NADA ───────────────────────────────────────────────
 *
 * Cuando no hay bloques. A diferencia del panel del asistente —que enseña qué
 * está vigilando para que una caja vacía no enseñe a no volver— aquí el vacío es
 * ausencia total: la sección no aparece. La diferencia es que el panel se abre a
 * propósito y merece una respuesta; esta sección vive dentro de una pantalla de
 * trabajo, y ahí un recuadro que dice «nada que reportar» es ruido permanente
 * en el sitio donde alguien intenta hacer otra cosa.
 */
export async function AnalysisSection({
  route,
  id,
  title = "Lo que dice el análisis",
}: {
  /** La ruta normalizada de la pantalla: `/admin/crm`, `/admin/refacciones`… */
  route: string;
  /** El identificador, cuando la pantalla es una ficha. */
  id?: string;
  title?: string;
}) {
  // El rol se le pasa a `scopeFor`, que filtra ANÁLISIS POR ANÁLISIS. Hacer la
  // comprobación aquí sobre `scope.adminOnly` habría escondido la sección
  // entera en cuanto uno solo de los bloques exigiera administración, y con
  // ella los que soporte sí puede ver. El permiso pertenece al dato, y por eso
  // se aplica dato a dato.
  const scope = await scopeFor(route, { isAdmin: isAdminRole(await currentRole()) });
  if (!scope) return null;

  const bloques = await scope.resolve({ id });
  if (bloques.length === 0) return null;

  // Por grado de certeza, como en el panel: de «haz algo hoy» a «entiende el
  // contexto». Que el orden sea el mismo en los dos sitios no es cosmético —
  // es lo que permite reconocer un bloque sin leer su encabezado.
  const porTipo = BLOCK_ORDER.map((kind) => ({
    kind,
    items: bloques.filter((b) => b.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Sparkles className="size-4 text-primary" />
        {title}
      </h2>

      {porTipo.map((g) => (
        <div key={g.kind} className="space-y-3">
          {/* El encabezado del tipo solo cuando hay más de uno: con un solo
              grupo, «Lo que estima el modelo» encima de «Lo que dice el
              análisis» son dos títulos para una caja. */}
          {porTipo.length > 1 && (
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {BLOCK_LABEL[g.kind]}
            </h3>
          )}
          <div className="grid gap-3">
            {g.items.map((b) => (
              <Bloque key={llave(b)} block={b} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Bloque({ block }: { block: Block }) {
  switch (block.kind) {
    case "finding":
      return <InsightItem insight={block.insight} />;
    case "projection":
      return <ProjectionCard block={block} />;
    case "trend":
      return <TrendCard block={block} />;
    case "forecast":
      return <ForecastCard block={block} />;
  }
}

/** Los hallazgos llevan su id dentro del `insight`; el resto, suelto. */
function llave(b: Block): string {
  return b.kind === "finding" ? b.insight.id : b.id;
}

/**
 * El hueco mientras llega. Del alto aproximado de una tarjeta, para que la
 * pantalla no dé un salto cuando el análisis aterriza.
 */
export function AnalysisSectionSkeleton() {
  return (
    <section className="space-y-3">
      <div className="h-4 w-44 animate-pulse rounded bg-muted" />
      <div className="h-32 animate-pulse rounded-xl bg-muted/60" />
    </section>
  );
}
