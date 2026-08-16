"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { AnalysisAssistant } from "@/components/portal/analysis-assistant";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { TenantMark, type TenantBrand } from "@/components/portal/tenant-mark";

export function Topbar({
  name,
  email,
  brand,
}: {
  name?: string | null;
  email?: string | null;
  brand: TenantBrand;
}) {
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="no-print flex h-16 items-center justify-between gap-4 border-b border-border bg-card/40 px-6 backdrop-blur">
      {/* En móvil no hay barra lateral, así que la marca de la empresa vive
          aquí. Antes decía "Evoelution" a secas, en el portal de cualquiera. */}
      <div className="min-w-0 lg:hidden">
        <TenantMark brand={brand} />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {/* Sitio fijo en toda la aplicación: es lo que lo vuelve costumbre. */}
        <AnalysisAssistant />
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
    </header>
  );
}
