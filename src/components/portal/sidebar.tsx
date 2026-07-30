"use client";

import {
  LayoutDashboard,
  Ticket,
  PlusCircle,
  Inbox,
  BarChart3,
  ClipboardPlus,
  Users,
  Contact,
  Boxes,
  Building2,
  CalendarCheck,
  FileSignature,
  KanbanSquare,
  Mail,
  Package,
  Search,
  Settings,
  Target,
  TrendingUp,
  Users2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "@/components/shared/logo";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; Icon: LucideIcon };

function navFor(role: Role): { section: string; items: NavItem[] }[] {
  const client: NavItem[] = [
    { href: "/dashboard", label: "Inicio", Icon: LayoutDashboard },
    { href: "/tickets", label: "Mis tickets", Icon: Ticket },
    { href: "/tickets/new", label: "Nuevo ticket", Icon: PlusCircle },
  ];
  if (role === "client") return [{ section: "Portal", items: client }];

  // CRM: embudo de ventas (vendedor y admin).
  const crm: NavItem[] = [
    { href: "/admin/crm", label: "Embudo", Icon: KanbanSquare },
    { href: "/admin/crm/organizaciones", label: "Organizaciones", Icon: Building2 },
    { href: "/admin/crm/contactos", label: "Contactos", Icon: Users2 },
    { href: "/admin/crm/actividades", label: "Actividades", Icon: CalendarCheck },
    { href: "/admin/crm/informes", label: "Informes", Icon: BarChart3 },
    { href: "/admin/crm/objetivos", label: "Objetivos", Icon: Target },
    { href: "/admin/crm/buscar", label: "Buscar", Icon: Search },
  ];

  // Vendedor: solo su ámbito comercial.
  if (role === "sales") {
    return [
      { section: "CRM", items: crm },
      {
        section: "Comercial",
        items: [
          { href: "/dashboard", label: "Panel", Icon: LayoutDashboard },
          { href: "/admin/contratos", label: "Contratos", Icon: FileSignature },
          { href: "/admin/leads", label: "Leads", Icon: Contact },
        ],
      },
    ];
  }

  const agent: NavItem[] = [
    { href: "/dashboard", label: "Panel", Icon: LayoutDashboard },
    { href: "/admin/tickets", label: "Cola de tickets", Icon: Inbox },
    { href: "/admin/tickets/new", label: "Nuevo levantamiento", Icon: ClipboardPlus },
    { href: "/admin/refacciones", label: "Refacciones", Icon: Package },
  ];
  const adminExtra: NavItem[] = [
    { href: "/admin/contratos", label: "Contratos", Icon: FileSignature },
    { href: "/admin/rentabilidad", label: "Rentabilidad", Icon: TrendingUp },
    { href: "/admin/leads", label: "Leads", Icon: Contact },
    { href: "/admin/users", label: "Usuarios", Icon: Users },
    { href: "/admin/catalog", label: "Catálogo", Icon: Boxes },
    { href: "/admin/configuracion", label: "Configuración", Icon: Settings },
  ];

  if (role === "agent") return [{ section: "Operación", items: agent }];
  return [
    { section: "Operación", items: agent },
    {
      section: "CRM",
      items: [
        ...crm,
        { href: "/admin/crm/plantillas", label: "Plantillas", Icon: Mail },
        {
          href: "/admin/crm/automatizaciones",
          label: "Automatizaciones",
          Icon: Workflow,
        },
        { href: "/admin/crm/configuracion", label: "Embudos", Icon: Settings },
      ],
    },
    { section: "Administración", items: adminExtra },
  ];
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const groups = navFor(role);

  // Se marca activo solo el enlace más específico que coincide con la ruta,
  // para que "/admin/crm" no quede encendido junto a "/admin/crm/contactos".
  const bestMatch = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto p-4">
        {groups.map((g) => (
          <div key={g.section}>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {g.section}
            </p>
            <ul className="space-y-1">
              {g.items.map(({ href, label, Icon }) => {
                const active = href === bestMatch;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        Rol: <span className="font-medium capitalize text-foreground">{role}</span>
      </div>
    </aside>
  );
}
