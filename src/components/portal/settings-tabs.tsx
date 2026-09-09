"use client";

import {
  Palette,
  Users,
  Boxes,
  Settings2,
  Mail,
  Workflow,
  Telescope,
  Orbit,
  Plane,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  Icon: LucideIcon;
  exact?: boolean;
  /** Qué módulo la manda. Sin declarar, la manda Configuración. */
  modulo?: "viaticos";
};

/**
 * Sub-navegación del área de configuración.
 *
 * El orden no es alfabético ni por importancia: va de lo que se toca al montar
 * la empresa a lo que se toca casi nunca. Quien entra por primera vez recorre
 * la fila de izquierda a derecha y eso es exactamente lo que tiene que hacer.
 */
const TABS: Tab[] = [
  { href: "/admin/configuracion", label: "Marca y tarifas", Icon: Palette, exact: true },
  { href: "/admin/configuracion/usuarios", label: "Usuarios", Icon: Users },
  { href: "/admin/configuracion/catalogo", label: "Catálogo", Icon: Boxes },
  { href: "/admin/configuracion/embudos", label: "Embudos y etapas", Icon: Settings2 },
  { href: "/admin/configuracion/plantillas", label: "Plantillas", Icon: Mail },
  {
    href: "/admin/configuracion/automatizaciones",
    label: "Automatizaciones",
    Icon: Workflow,
  },
  // Al final por el mismo criterio que ordena el resto: se toca cuando ya hay
  // operación andando y alguien decide que un análisis sobra o falta, no al
  // montar la empresa.
  { href: "/admin/configuracion/analisis", label: "Qué se analiza", Icon: Telescope },
  // La única pestaña que NO pide `configuracion: administrar`: la manda
  // `viaticos: administrar`, así que la ve también General. Ver `RUTAS` en
  // `lib/permisos.ts` — y por eso `SettingsTabs` recibe qué puede abrir quien
  // mira, en vez de pintar la fila entera para todos.
  { href: "/admin/configuracion/viaticos", label: "Viáticos", Icon: Plane, modulo: "viaticos" },
  // Al final y no al principio: es de la CUENTA, no de cómo trabaja la
  // empresa. Quien entra a Configuración viene casi siempre a otra cosa, y
  // ponerla primero convertiría esta área en una pantalla de cobro.
  { href: "/admin/configuracion/suscripcion", label: "Suscripción", Icon: Orbit },
];

/**
 * Recibe QUÉ PUEDE ABRIR quien mira, y no lo adivina.
 *
 * Desde que existe la pestaña de Viáticos, el área tiene dos guardias
 * distintos: casi todo pide `configuracion: administrar` y Viáticos pide
 * `viaticos: administrar`. General entra solo a esa.
 *
 * Pintar la fila entera para todos y dejar que el guardia rebote es
 * exactamente el fallo que `portal/menu.ts` documenta en su cabecera: la barra
 * enseñaba lo que la ruta no dejaba abrir. Así que la decisión se toma en el
 * servidor —donde se puede preguntar— y llega hecha.
 */
export function SettingsTabs({
  puedeConfiguracion,
  puedeViaticos,
}: {
  puedeConfiguracion: boolean;
  puedeViaticos: boolean;
}) {
  const pathname = usePathname();
  const visibles = TABS.filter((t) =>
    t.modulo === "viaticos" ? puedeViaticos : puedeConfiguracion,
  );

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px">
      {visibles.map(({ href, label, Icon, exact }) => {
        // "Marca y tarifas" es la raíz del área: sin `exact` se quedaría
        // encendida en todas las pestañas, porque todas empiezan por su ruta.
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
