import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * Esqueletos de carga del ERP.
 *
 * Son componentes de servidor sin estado ni interactividad a propósito: viajan
 * dentro del HTML inicial y no añaden un solo byte de JavaScript. Un esqueleto
 * que necesitara hidratarse llegaría tarde justo cuando hace falta.
 *
 * La forma importa más que el adorno. Cada esqueleto imita la GEOMETRÍA de la
 * pantalla que va a reemplazar —el número de tarjetas, el ancho de las columnas
 * de la tabla— para que el contenido real no reacomode la página al llegar. Un
 * rectángulo genérico se ve igual de "cargando" y produce un salto visible.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      aria-hidden
    />
  );
}

/** Título de sección con su bajada. */
export function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

/** Fila de tarjetas de indicador (los KPI de arriba de casi toda pantalla). */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
        </Card>
      ))}
    </div>
  );
}

/**
 * Tabla en espera.
 *
 * `cols` reparte anchos decrecientes en vez de columnas iguales: en las tablas
 * reales la primera columna (folio, nombre) es la ancha y las últimas son
 * insignias cortas, así que columnas iguales delatarían el esqueleto.
 */
export function TableSkeleton({
  rows = 8,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  const widths = ["w-28", "w-48", "w-36", "w-24", "w-20", "w-16", "w-24", "w-20"];
  return (
    <Card className="overflow-hidden">
      <div className="flex gap-6 border-b border-border bg-secondary/40 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", widths[i] ?? "w-20")} />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-6 px-4 py-3.5">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn("h-4", widths[c] ?? "w-20")} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Gráfica en espera: el marco con la altura real, sin inventar barras. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-48 w-full" />
    </Card>
  );
}

/** Lista de tarjetas apiladas (paneles de detalle, bandejas, fichas). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <div className="border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Fallback por omisión de una pantalla del ERP.
 *
 * Lo usa `loading.tsx`, que no sabe a qué página va a reemplazar: sirve para
 * las de forma "encabezado + indicadores + tabla", que son la mayoría.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-8">
      <HeaderSkeleton />
      <StatCardsSkeleton />
      <TableSkeleton />
    </div>
  );
}
