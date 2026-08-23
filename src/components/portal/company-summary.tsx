import {
  Inbox,
  KanbanSquare,
  Building2,
  Package,
  ShoppingCart,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { resumenEmpresa } from "@/lib/data/resumen";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * La empresa entera, por áreas, en la pantalla de llegada.
 *
 * ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
 *
 * El panel hablaba solo de tickets. La empresa tiene además ventas, clientes,
 * inventario y compras, y en bajío eso son miles de filas que la pantalla de
 * entrada no mencionaba. Quien lleva un año usando el sistema no lo nota —entra
 * a lo suyo por el menú—; quien llega de visita se lleva la idea de que la
 * empresa es una cola de tickets.
 *
 * ── POR QUÉ SE FILTRA POR ROL ──────────────────────────────────────────────
 *
 * Un área cuya pantalla no está en el menú de este rol no se enseña, ni siquiera
 * como cifra. Un vendedor no tiene Compras: decirle que hay 33 facturas por
 * pagar es contarle algo que no puede ir a ver, y además es información de
 * administración. La regla se toma del MISMO sitio que el menú —`menuDelRol`
 * vía `pantallasVisibles`— para que no haya dos listas que un día digan cosas
 * distintas.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No sustituye a las pantallas de cada área: son dos o tres cifras y un enlace.
 * Un resumen que intente ser el informe acaba siendo un informe malo, y el bueno
 * ya existe en cada sección.
 */

type Area = {
  clave: string;
  titulo: string;
  Icon: LucideIcon;
  /** La pantalla del área: decide si este rol la ve, y a dónde lleva. */
  href: string;
  cifras: Array<{ etiqueta: string; valor: string; alerta?: boolean }>;
};

export async function CompanySummary({
  pantallas,
  locale,
}: {
  /**
   * Direcciones del menú de este rol, de `pantallasDelRol`. Es el rol ya
   * resuelto: pasar además el rol y volver a derivarlas aquí serían dos
   * caminos a la misma respuesta, y el día que discrepen gana el equivocado.
   */
  pantallas: Set<string>;
  locale: string;
}) {
  const r = await resumenEmpresa();
  if (!r) {
    return (
      <Card className="border-dashed p-6">
        <p className="text-sm text-muted-foreground">
          Todavía no hay nada que resumir: esta empresa no tiene datos cargados.
        </p>
      </Card>
    );
  }

  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX");
  const dinero = (n: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
      style: "currency",
      currency: "MXN",
      notation: n >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: n >= 1_000_000 ? 1 : 0,
    }).format(n);

  const areas: Area[] = [
    {
      clave: "servicio",
      titulo: "Servicio",
      Icon: Inbox,
      href: "/admin/tickets",
      cifras: [
        { etiqueta: "Tickets", valor: nf.format(r.servicio.total) },
        { etiqueta: "Abiertos", valor: nf.format(r.servicio.abiertos) },
        {
          etiqueta: "Sin asignar",
          valor: nf.format(r.servicio.sinAsignar),
          alerta: r.servicio.sinAsignar > 0,
        },
      ],
    },
    {
      clave: "ventas",
      titulo: "Ventas",
      Icon: KanbanSquare,
      href: "/admin/crm",
      cifras: [
        { etiqueta: "Abiertos", valor: nf.format(r.ventas.abiertos) },
        { etiqueta: "En juego", valor: dinero(r.ventas.valorAbierto) },
        { etiqueta: "Ganados", valor: nf.format(r.ventas.ganados) },
      ],
    },
    {
      clave: "clientes",
      titulo: "Clientes",
      Icon: Building2,
      href: "/admin/clientes",
      cifras: [
        { etiqueta: "Clientes", valor: nf.format(r.clientes.total) },
        { etiqueta: "Contratos", valor: nf.format(r.clientes.contratos) },
        {
          etiqueta: "Por vencer",
          valor: nf.format(r.clientes.porVencer),
          alerta: r.clientes.porVencer > 0,
        },
      ],
    },
    {
      clave: "inventario",
      titulo: "Inventario",
      Icon: Package,
      href: "/admin/refacciones",
      cifras: [
        { etiqueta: "Refacciones", valor: nf.format(r.inventario.refacciones) },
        {
          etiqueta: "Sin existencia",
          valor: nf.format(r.inventario.sinExistencia),
          alerta: r.inventario.sinExistencia > 0,
        },
      ],
    },
    {
      clave: "compras",
      titulo: "Compras",
      Icon: ShoppingCart,
      href: "/admin/compras",
      cifras: [
        { etiqueta: "Órdenes abiertas", valor: nf.format(r.compras.ordenes) },
        { etiqueta: "Por pagar", valor: nf.format(r.compras.porPagar) },
        {
          etiqueta: "Vencidas",
          valor: nf.format(r.compras.vencidas),
          alerta: r.compras.vencidas > 0,
        },
      ],
    },
  ];

  const visibles = areas.filter((a) => pantallas.has(a.href));
  if (visibles.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visibles.map((a) => (
        <Card key={a.clave} className="p-5 transition-colors hover:border-primary/40">
          <Link href={a.href} className="group flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold">
              <a.Icon className="size-4 text-primary" />
              {a.titulo}
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {a.cifras.map((c) => (
              <div key={c.etiqueta}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {c.etiqueta}
                </dt>
                <dd
                  className={cn(
                    "font-mono text-xl font-semibold tabular-nums",
                    // El ámbar solo cuando el número PIDE algo. Un cero en «sin
                    // asignar» es una buena noticia y pintarlo de alerta enseña
                    // a ignorar el color.
                    c.alerta && "text-warning",
                  )}
                >
                  {c.valor}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}
