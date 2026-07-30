"use client";

import {
  BarChart3,
  Building2,
  CalendarCheck,
  KanbanSquare,
  Mail,
  Search,
  Settings2,
  Target,
  Users2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; Icon: LucideIcon; exact?: boolean };

const TABS: Tab[] = [
  { href: "/admin/crm", label: "Embudo", Icon: KanbanSquare, exact: true },
  { href: "/admin/crm/organizaciones", label: "Organizaciones", Icon: Building2 },
  { href: "/admin/crm/contactos", label: "Contactos", Icon: Users2 },
  { href: "/admin/crm/actividades", label: "Actividades", Icon: CalendarCheck },
  { href: "/admin/crm/informes", label: "Informes", Icon: BarChart3 },
  { href: "/admin/crm/objetivos", label: "Objetivos", Icon: Target },
  { href: "/admin/crm/plantillas", label: "Plantillas", Icon: Mail },
  { href: "/admin/crm/buscar", label: "Buscar", Icon: Search },
];

const ADMIN_TABS: Tab[] = [
  { href: "/admin/crm/automatizaciones", label: "Automatizaciones", Icon: Workflow },
  { href: "/admin/crm/configuracion", label: "Embudos", Icon: Settings2 },
];

export function CrmTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map(({ href, label, Icon, exact }) => {
        // "Embudo" solo se marca activo en su ruta exacta; el detalle de un
        // negocio (/negocios/…) también pertenece al embudo.
        const active = exact
          ? pathname === href || pathname.startsWith("/admin/crm/negocios")
          : pathname.startsWith(href);
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
