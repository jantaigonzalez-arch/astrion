import { cn } from "@/lib/utils";

/**
 * Marca Astraion: astro con órbita.
 *
 * Existe porque la puerta de acceso del producto estaba mostrando el logo de
 * Evoelution, que es un CLIENTE. Es el mismo error que `TenantMark` vino a
 * corregir dentro de los portales, cometido un nivel más arriba: quien entra
 * por `astraion.com/login` puede ser de cualquier empresa, y recibirlo con la
 * marca de otro laboratorio no es un descuido estético — le dice que se
 * equivocó de sitio.
 *
 * Deliberadamente distinta del monograma de Evoelution, que dibuja picos de
 * cromatograma: eso es su negocio, no el nuestro. Aquí un punto luminoso y su
 * órbita, que es el lenguaje visual de la landing —el campo de estrellas— y se
 * lee a 30 píxeles sin convertirse en una mancha.
 */
export function AstraionLogo({
  className,
  showWord = true,
}: {
  className?: string;
  showWord?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="url(#astraion-g)" />
        {/* Órbita inclinada. La elipse rotada da profundidad sin necesitar
            sombras, que a este tamaño se ensucian. */}
        <ellipse
          cx="16"
          cy="16"
          rx="10.5"
          ry="4.5"
          transform="rotate(-28 16 16)"
          stroke="white"
          strokeOpacity="0.75"
          strokeWidth="1.6"
          fill="none"
        />
        {/* El astro, ligeramente descentrado: sobre la órbita, no dentro. */}
        <circle cx="16" cy="16" r="3.4" fill="white" />
        <circle cx="24.5" cy="9.5" r="1.5" fill="white" fillOpacity="0.9" />
        <defs>
          <linearGradient id="astraion-g" x1="0" y1="0" x2="32" y2="32">
            <stop stopColor="oklch(0.52 0.19 258)" />
            <stop offset="1" stopColor="oklch(0.7 0.15 205)" />
          </linearGradient>
        </defs>
      </svg>
      {showWord && (
        <span className="text-lg font-semibold tracking-tight">
          Astra<span className="text-primary">ion</span>
        </span>
      )}
    </span>
  );
}
