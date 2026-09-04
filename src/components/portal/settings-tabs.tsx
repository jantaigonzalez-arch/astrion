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
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; Icon: LucideIcon; exact?: boolean };

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
  // Al final y no al principio: es de la CUENTA, no de cómo trabaja la
  // empresa. Quien entra a Configuración viene casi siempre a otra cosa, y
  // ponerla primero convertiría esta área en una pantalla de cobro.
  { href: "/admin/configuracion/suscripcion", label: "Suscripción", Icon: Orbit },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px">
      {TABS.map(({ href, label, Icon, exact }) => {
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
