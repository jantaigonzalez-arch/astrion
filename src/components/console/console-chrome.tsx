"use client";

import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  LogOut,
  Building2,
  ShieldAlert,
  Home,
  Inbox,
  History,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * Marco visual de la consola de Astraion.
 *
 * A propósito NO reutiliza `Sidebar`/`Topbar` del portal: esos llevan el
 * nombre y la navegación de una empresa, y la consola está por debajo de
 * cualquier empresa. Que se vean distintas es el punto — es la señal de que
 * cambiaste de plano, no de sección.
 *
 * ── POR QUÉ AHORA HAY NAVEGACIÓN ───────────────────────────────────────────
 *
 * Porque antes no hacía falta: la consola era UNA pantalla con todo apilado
 * dentro —empresas, solicitudes, bitácora y el formulario de alta—, así que
 * moverse era desplazarse. Al partirla en secciones hay a dónde ir, y sin una
 * fila que lo diga las tres nuevas serían direcciones que solo conoce quien
 * escribió el código.
 *
 * Una fila horizontal y no una barra lateral como el portal: son cuatro
 * destinos y no van a ser veinte. Una lateral gastaría un cuarto del ancho en
 * enseñar cuatro palabras, y además volvería a parecerse al portal, que es de
 * lo que esta cáscara huye.
 *
 * `next/link` y `usePathname` de `next/navigation`, no los de `@/lib/nav`: los
 * de la aplicación anteponen el prefijo de la EMPRESA activa, y aquí no hay
 * ninguna — un enlace así mandaría a la consola dentro del portal de un
 * cliente, que es exactamente la confusión que separar los planos vino a
 * evitar.
 */
export function ConsoleChrome({
  children,
  name,
  email,
  platformRole,
  locale,
  solicitudesPendientes = 0,
}: {
  children: React.ReactNode;
  locale: string;
  name?: string | null;
  email?: string | null;
  platformRole?: string | null;
  /** Para el punto en «Solicitudes». Cero lo apaga. */
  solicitudesPendientes?: number;
}) {
  const pathname = usePathname();
  const prefijo = locale === "en" ? "/en" : "";
  const esSuper = platformRole === "superadmin";

  const secciones = [
    { href: "/platform", label: "Inicio", Icon: Home },
    { href: "/platform/empresas", label: "Empresas", Icon: Building2 },
    // Solo el superadministrador aprueba altas; a soporte le sería un renglón
    // que abre una pantalla donde no puede hacer nada.
    ...(esSuper
      ? [{ href: "/platform/solicitudes", label: "Solicitudes", Icon: Inbox }]
      : []),
    { href: "/platform/bitacora", label: "Bitácora", Icon: History },
    // Al final: se abre cuando alguien se pregunta si cabe otro cliente, no en
    // el día a día. Por eso tampoco está en la bienvenida, que tiene escrito
    // que orienta y no inventaría.
    { href: "/platform/capacidad", label: "Capacidad", Icon: Gauge },
  ];
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
          <div className="flex items-center gap-2.5">
            {/* La marca de la plataforma, no la de la empresa. */}
            <span className="flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-signal">
              <Building2 className="size-4 text-white" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">Astraion</div>
              <div className="text-[11px] text-muted-foreground">
                Consola de plataforma
              </div>
            </div>
          </div>

          <span className="ml-2 hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary ring-1 ring-primary/20 sm:inline-flex">
            <ShieldAlert className="size-3" />
            {platformRole === "superadmin" ? "Superadministrador" : "Soporte"}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-signal text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="hidden text-sm sm:block">
                <div className="font-medium leading-tight">{name ?? email}</div>
                <div className="text-xs text-muted-foreground">{email}</div>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Salir"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>

        {/* La fila de secciones va DEBAJO de la marca y dentro del mismo
            encabezado pegajoso: se mueve con la página tanto como el logo, que
            es cero, y así la bitácora —que es larga— no obliga a subir hasta
            arriba para cambiar de sección. */}
        <nav className="mx-auto max-w-7xl px-6">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {secciones.map(({ href, label, Icon }) => {
              // Coincidencia exacta para «Inicio» y por prefijo para el resto:
              // `/platform` es prefijo de todas, así que sin esta distinción
              // Inicio se quedaría encendido en las cuatro.
              const activa =
                href === "/platform"
                  ? pathname === `${prefijo}/platform`
                  : pathname.startsWith(`${prefijo}${href}`);
              return (
                <li key={href}>
                  <Link
                    href={`${prefijo}${href}`}
                    aria-current={activa ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      activa
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                    {label === "Solicitudes" && solicitudesPendientes > 0 && (
                      <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-warning/25">
                        {solicitudesPendientes}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl p-6 lg:p-8">{children}</main>
    </div>
  );
}
