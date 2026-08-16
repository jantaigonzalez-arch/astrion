import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { pageCountOf, pageHref, rangeOf, type PageParams } from "@/lib/pagination";

/**
 * Controles de página.
 *
 * Componente de servidor, y son enlaces de verdad: cada página es una URL que
 * se puede compartir, marcar y abrir en otra pestaña. Un paginador de botones
 * con estado en el cliente habría necesitado hidratación para algo que el
 * navegador ya sabe hacer, y habría perdido la página al recargar.
 *
 * Se dibuja "anterior / siguiente" y no la ristra de números: con 602 tickets
 * son 25 páginas, y una fila de 25 dígitos no ayuda a nadie a encontrar nada.
 * Para buscar algo concreto está el filtro; el paginador es para hojear.
 */
export function Pagination({
  page,
  perPage,
  total,
  basePath,
  query = {},
  className,
}: PageParams & {
  total: number;
  basePath: string;
  query?: Record<string, string | undefined>;
  className?: string;
}) {
  const pageCount = pageCountOf(total, perPage);
  const { from, to } = rangeOf(total, { page, perPage, offset: 0 });

  // Con una sola página no hay nada que decidir, pero el recuento sí importa:
  // "48 de 48" confirma que la tabla está completa y que no falta nada abajo.
  const nf = new Intl.NumberFormat("es-MX");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm",
        className,
      )}
    >
      <p className="text-muted-foreground">
        {total === 0 ? (
          "Sin resultados"
        ) : (
          <>
            {nf.format(from)}–{nf.format(to)} de{" "}
            <span className="font-medium text-foreground">{nf.format(total)}</span>
          </>
        )}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageLink
            href={pageHref(basePath, page - 1, query)}
            disabled={page <= 1}
            label="Anterior"
          >
            <ChevronLeft className="size-4" /> Anterior
          </PageLink>
          <span className="px-1 text-xs text-muted-foreground">
            Página {nf.format(page)} de {nf.format(pageCount)}
          </span>
          <PageLink
            href={pageHref(basePath, page + 1, query)}
            disabled={page >= pageCount}
            label="Siguiente"
          >
            Siguiente <ChevronRight className="size-4" />
          </PageLink>
        </div>
      )}
    </div>
  );
}

/**
 * En los extremos se pinta un `<span>` y no un `<a>` deshabilitado: un enlace
 * sin destino sigue siendo enfocable con el teclado y anunciado por el lector
 * de pantalla como algo que se puede pulsar.
 */
function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors";

  if (disabled) {
    return (
      <span className={cn(base, "cursor-not-allowed opacity-40")} aria-hidden>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label} className={cn(base, "hover:bg-secondary")}>
      {children}
    </Link>
  );
}
