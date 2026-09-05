import { Phone } from "lucide-react";
import { avisoDelTelefono, telHref, telefonoLegible } from "@/lib/telefono";
import { cn } from "@/lib/utils";

/**
 * UN TELÉFONO, PINTADO IGUAL EN TODAS PARTES.
 *
 * Se pintaba a mano en ocho sitios —la ficha, sus contactos, el detalle del
 * negocio, dos tablas, el contrato, la bandeja de altas— y en cada uno con su
 * propio icono, su propio tamaño y un `href={`tel:${valor}`}` crudo. Ese enlace
 * crudo es el problema de fondo: manda al marcador lo que hubiera escrito quien
 * capturó, así que «01 800.5030.909» o «2789-2000 EXT. 1112» producían un enlace
 * que no marca nada.
 *
 * ── SIN ENLACE CUANDO NO SE PUEDE MARCAR ──────────────────────────────────
 *
 * Un número de ocho dígitos —de los de antes de 2019, y hay 32— no se puede
 * marcar sin saber su lada. Pintar un enlace que falla es peor que no pintarlo:
 * quien lo pulsa cree que el sistema tiene el dato y que el teléfono está mal.
 * Aquí se enseña como texto y el motivo va en el `title`, para que quien pase por
 * encima sepa qué le falta.
 */
export function Telefono({
  valor,
  className,
  iconClassName = "size-3.5",
  sinIcono = false,
}: {
  valor: string | null | undefined;
  className?: string;
  iconClassName?: string;
  /** Para las tablas donde la columna ya se llama «Teléfono». */
  sinIcono?: boolean;
}) {
  const texto = telefonoLegible(valor);
  if (!texto) return null;

  const href = telHref(valor);
  const aviso = avisoDelTelefono(valor);
  const contenido = (
    <>
      {!sinIcono && <Phone className={cn("shrink-0", iconClassName)} />}
      {texto}
    </>
  );

  if (!href) {
    return (
      <span
        title={aviso ? `No se puede marcar: ${aviso}.` : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 text-muted-foreground",
          aviso && "decoration-dotted underline-offset-4",
          aviso && "underline",
          className,
        )}
      >
        {contenido}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary",
        className,
      )}
    >
      {contenido}
    </a>
  );
}
