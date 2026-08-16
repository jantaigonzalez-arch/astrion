import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * «Powered by Astraion».
 *
 * Va de la pantalla de acceso hacia adentro, nunca en el sitio público de la
 * empresa: quien visita evoelution.com viene por Evoelution y ahí la
 * plataforma no pinta nada. Quien inicia sesión, en cambio, está usando el
 * sistema, y saber sobre qué corre es información legítima —para él y para
 * Astraion, que se hace conocer en cada empresa que lo usa—.
 *
 * El `Link` es el de `@/lib/nav` y no el de `@/i18n/navigation`, y ahí está el
 * arreglo entero: desde `evoelution.astraion.com`, `/` es la raíz del portal
 * DEL CLIENTE, así que el enlace llevaba a su propio dashboard en vez de a la
 * página del producto — justo lo contrario de lo que esta pieza existe para
 * hacer. El `Link` del portal conoce el apex y resuelve `/` hacia él.
 *
 * Se resuelve en el cliente y no leyendo `next/headers` porque este componente
 * lo usa `sidebar.tsx`, que es un componente de cliente: la versión con
 * `headers()` no compilaba.
 */
export function PoweredByAstraion({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <span>Powered by</span>
      <span className="inline-flex items-center gap-1 font-medium text-foreground/80 group-hover:text-primary">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-gradient-to-br from-brand-500 to-signal"
        />
        Astraion
      </span>
    </Link>
  );
}
