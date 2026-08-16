import "server-only";
import { FEATURES, MAX_FEATURES, SUBJECTS, TARGETS } from "@/lib/ml/blocks";
import type { Catalog } from "@/components/portal/ml-template-builder";

/**
 * La ontología, aplanada para el constructor de preguntas.
 *
 * `blocks.ts` guarda cada bloque con lo que el compilador de consultas necesita
 * —fragmentos SQL, escaleras, anclas temporales—, y nada de eso puede cruzar al
 * cliente: son las piezas con las que se arma una consulta, y enviarlas al
 * navegador sería mandar el motor entero para que alguien elija un desplegable.
 *
 * Esto se queda con lo que hace falta para ELEGIR: qué se puede predecir, sobre
 * qué, y con qué agrupar. `safeBecause` viaja porque el constructor lo enseña:
 * un rasgo se ofrece con su justificación al lado, para que quien arma la
 * pregunta sepa por qué ese dato es legítimo y no tenga que confiar a ciegas.
 */
export function catalogView(): Catalog {
  return {
    subjects: SUBJECTS.map((s) => ({ id: s.id, label: s.label })),
    targets: TARGETS.map((t) => ({
      id: t.id,
      subject: t.subject,
      label: t.label,
      unit: t.unit,
      defaultTolerance: t.defaultTolerance,
    })),
    features: FEATURES.map((f) => ({
      id: f.id,
      subjects: f.subjects,
      label: f.label,
      safeBecause: f.safeBecause,
    })),
    maxFeatures: MAX_FEATURES,
  };
}
