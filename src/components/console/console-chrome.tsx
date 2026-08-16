"use client";

import { signOut } from "next-auth/react";
import { LogOut, Building2, ShieldAlert } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/**
 * Marco visual de la consola de Astraion.
 *
 * A propósito NO reutiliza `Sidebar`/`Topbar` del portal: esos llevan el
 * nombre y la navegación de una empresa, y la consola está por debajo de
 * cualquier empresa. Que se vean distintas es el punto — es la señal de que
 * cambiaste de plano, no de sección.
 */
export function ConsoleChrome({
  children,
  name,
  email,
  platformRole,
}: {
  children: React.ReactNode;
  locale: string;
  name?: string | null;
  email?: string | null;
  platformRole?: string | null;
}) {
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
      </header>

      <main className="mx-auto max-w-7xl p-6 lg:p-8">{children}</main>
    </div>
  );
}
