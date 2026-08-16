import { Clock, Package, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Hoja de servicio: lo que se le hizo al equipo, para el CLIENTE.
 *
 * No es la bitácora. La bitácora es el cuaderno del técnico y se queda interna,
 * porque su texto libre trae cosas que no salen del taller: viáticos con
 * importe, notas de trabajo («REVISAR», «PENDIENTE») y —lo más delicado— el
 * nombre de OTROS clientes dentro del ticket de uno («es de Baxter, pero está
 * en LEI»). Publicar eso en bloque le enseñaría a un laboratorio de quién es el
 * equipo que tiene instalado.
 *
 * Lo que sí es suyo son los HECHOS, y están en columnas y no en prosa: cuándo
 * se le atendió, qué equipo y módulo se tocó, cuántas horas llevó y qué
 * refacciones se instalaron. Eso es exactamente lo que esta hoja muestra.
 *
 * Dos ausencias deliberadas:
 *
 * - **Ni una línea de texto libre.** No hay filtro que valga: acertar el 97 %
 *   no sirve cuando el 3 % restante nombra a un competidor.
 * - **Ningún importe.** Ni costo ni precio de refacción. El número de parte y
 *   la descripción sí, porque son la pieza que quedó en su equipo y tiene
 *   derecho a saber cuál es.
 *
 * Antes de esto, el cliente entraba a su ticket y no veía absolutamente nada:
 * los 534 comentarios del histórico están marcados como internos, así que la
 * lista de respuestas salía vacía en todos los tickets sin excepción.
 */

type Part = {
  id: string;
  partNumber: string;
  description: string;
  quantity: number;
};

type Activity = {
  id: string;
  createdAt: Date | string;
  hours: string | null;
  equipment: { brand: string; name: string } | null;
  module: { name: string; serialNumber: string | null } | null;
  submodule: { name: string; serialNumber: string | null } | null;
  parts: Part[];
};

export function ServiceSheet({
  activities,
  locale,
}: {
  activities: Activity[];
  locale: string;
}) {
  /*
    Una actividad sin horas, sin refacciones y sin equipo no tiene NADA que
    contarle al cliente: todo lo que aporta está en el texto que no se publica.
    Dibujarla sería una tarjeta con una fecha y aire, y varias seguidas dan la
    impresión de que se perdió información.
  */
  const visibles = activities.filter(
    (a) => a.hours || a.parts.length > 0 || a.equipment,
  );

  const totalHoras = visibles.reduce((s, a) => s + Number(a.hours ?? 0), 0);
  const totalPiezas = visibles.reduce(
    (s, a) => s + a.parts.reduce((n, p) => n + p.quantity, 0),
    0,
  );

  const fecha = (d: Date | string) =>
    new Date(d).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  if (visibles.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">
          Todavía no hay actividad de servicio registrada en este ticket.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-4">
        <h2 className="font-semibold">Hoja de servicio</h2>
        <span className="text-xs text-muted-foreground">
          {visibles.length} intervención(es)
          {totalHoras > 0 && ` · ${totalHoras.toFixed(2)} h`}
          {totalPiezas > 0 && ` · ${totalPiezas} refacción(es)`}
        </span>
      </div>

      <ol className="divide-y divide-border">
        {visibles.map((a) => (
          <li key={a.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{fecha(a.createdAt)}</span>
              {a.hours && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  <Clock className="size-3" /> {Number(a.hours)} h
                </span>
              )}
            </div>

            {a.equipment && (
              <p className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-secondary/70 px-2 py-1 text-xs text-muted-foreground">
                <Wrench className="size-3 text-primary" />
                <span className="font-medium text-foreground">
                  {a.equipment.brand} {a.equipment.name}
                </span>
                {a.module && (
                  <>
                    <span>›</span>
                    <span>{a.module.name}</span>
                    {a.module.serialNumber && (
                      <span className="font-mono">S/N {a.module.serialNumber}</span>
                    )}
                  </>
                )}
                {a.submodule && (
                  <>
                    <span>›</span>
                    <span>{a.submodule.name}</span>
                    {a.submodule.serialNumber && (
                      <span className="font-mono">S/N {a.submodule.serialNumber}</span>
                    )}
                  </>
                )}
              </p>
            )}

            {a.parts.length > 0 && (
              <ul className="mt-2 space-y-1">
                {a.parts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Package className="size-3 text-primary" />
                    <span className="font-mono font-medium">{p.partNumber}</span>
                    <span className="min-w-0 flex-1 truncate">{p.description}</span>
                    <span>×{p.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Resumen de las intervenciones realizadas sobre tu equipo. Para el detalle
        técnico completo, pídele el reporte de servicio a tu ingeniero asignado.
      </p>
    </Card>
  );
}
