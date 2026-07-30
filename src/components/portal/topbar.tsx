"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export function Topbar({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}) {
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="no-print flex h-16 items-center justify-between gap-4 border-b border-border bg-card/40 px-6 backdrop-blur">
      <div className="lg:hidden">
        <span className="font-semibold">Evo<span className="text-primary">elution</span></span>
      </div>
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
    </header>
  );
}
