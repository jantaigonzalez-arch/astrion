import { cn } from "@/lib/utils";

/**
 * La marca de LA EMPRESA en cuyo portal estás.
 *
 * Reemplaza al `<Logo />` de Evoelution en todo lo que cuelga de `/[empresa]`.
 * Tener ahí la marca de Evoelution no era un descuido estético: al abrir
 * `/acme/acceso`, el cliente de ACME veía el logo de otro laboratorio —de uno
 * que además es su competencia— y con razón se preguntaría de quién es el
 * sistema y quién ve sus datos.
 *
 * Sin logo cargado se dibuja un monograma con su inicial. Deliberadamente
 * neutro y nunca un logo ajeno: es mejor no tener marca que tener la
 * equivocada.
 */
export type TenantBrand = {
  name: string;
  brandName: string | null;
  logoUrl: string | null;
};

export function TenantMark({
  brand,
  className,
  showWord = true,
  compact = false,
}: {
  brand: TenantBrand;
  className?: string;
  showWord?: boolean;
  /**
   * Encierra el logo en un cuadro de 32 px.
   *
   * Para la barra lateral plegada, que mide 64 px de ancho: ahí un logo
   * apaisado de 150 px se sale del riel. `showWord={false}` no alcanza, porque
   * eso solo quita el nombre — la imagen sigue midiendo lo que mide.
   */
  compact?: boolean;
}) {
  const label = brand.brandName?.trim() || brand.name;
  // Hasta dos iniciales: "Cromatografía del Bajío" → "CB".
  const initials = label
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  /*
    El nombre largo tiene que CABER, y caber es un problema de dos partes.

    La primera es que `truncate` no funciona solo: recorta al ancho del
    contenedor, y aquí el contenedor era un `inline-flex` sin `min-w-0`, que
    por definición crece hasta el contenido. «Instrumentos Analíticos del
    Bajío» se salía del riel de 288 px y pasaba por debajo del botón de plegar
    — con la clase `truncate` puesta desde el principio y sin efecto ninguno.
    Es el fallo de CSS más fácil de mirar sin ver.

    La segunda es que RECORTAR ES LO ÚLTIMO que hay que hacer, no lo primero.
    Un nombre recortado —«Instrumentos Analític…»— obliga a adivinar de qué
    empresa es el portal en el que estás, que es justo lo que este componente
    existe para evitar. Así que antes de perder letras se hacen dos cosas: se
    baja un punto la tipografía y se permiten DOS renglones. «Instrumentos
    Analíticos del Bajío» pasa de no caber a leerse entero en dos líneas.

    El recorte sigue ahí para el caso patológico —una razón social de ocho
    palabras— y entonces el nombre completo queda en el `title`, que es lo que
    el ratón puede recuperar.

    Veinte caracteres es dónde deja de caber en un renglón del riel de 288 px
    con el monograma al lado. No es una cifra redonda: es la que mide.
  */
  const largo = label.length > 20;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      {brand.logoUrl ? (
        // <img> y no <Image>: el logo es un archivo subido por el cliente, de
        // dimensiones desconocidas y servido por nginx desde un volumen. El
        // optimizador no aporta nada aquí y sí añade una ruta que puede fallar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoUrl}
          alt={label}
          className={cn(
            "h-8 shrink-0 object-contain",
            compact ? "w-8" : "w-auto max-w-[150px]",
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-signal text-xs font-semibold text-white"
        >
          {initials || "·"}
        </span>
      )}

      {showWord && !brand.logoUrl && (
        <span
          title={label}
          className={cn(
            "min-w-0 font-semibold tracking-tight",
            largo
              ? "line-clamp-2 text-sm leading-tight"
              : "truncate text-lg",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
