"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { AnalysisAssistant } from "@/components/portal/analysis-assistant";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { DensidadToggle } from "@/components/portal/densidad-toggle";
import type { Densidad } from "@/lib/densidad";
import { TenantMark, type TenantBrand } from "@/components/portal/tenant-mark";

export function Topbar({
  name,
  email,
  brand,
  campana,
  densidad,
}: {
  name?: string | null;
  email?: string | null;
  brand: TenantBrand;
  /**
   * La campana, ya resuelta en el servidor.
   *
   * Llega hecha y no como datos porque leer los avisos es una consulta a la
   * base, y esta barra es un componente de cliente —tiene desplegables y
   * estado—. Pasarla montada deja la consulta donde corresponde y evita que la
   * barra tenga que saber nada de notificaciones.
   */
  campana?: React.ReactNode;
  /** Densidad guardada, para que el menú nazca marcando la vigente. */
  densidad: Densidad;
}) {
  const initials = (name ?? email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    /*
      `relative z-30` no es decoración: es lo que deja que los desplegables de
      esta barra se vean POR DELANTE del contenido.

      Dos cosas se juntaban para esconderlos. `backdrop-blur` crea un contexto
      de apilamiento propio, así que el `z-50` del globo del asistente solo
      competía DENTRO del encabezado y no contra la página. Y el encabezado no
      tenía `z-index`, con lo que su contexto entero quedaba por debajo de
      `<main>`, que es su hermano posterior en el DOM y por tanto se pinta
      después.

      El resultado se veía justo donde más molesta: el globo abierto sobre el
      tablero del embudo, con las tarjetas de negocios dibujadas encima del
      texto. En pantallas de listado no se notaba, porque las filas no llegaban
      tan arriba — que es lo que hizo que pasara desapercibido.

      `z-30` y no más: por debajo del `z-40` con el que la barra lateral asoma
      al pasar el ratón, que sí debe taparlo.
    */
    <header className="no-print relative z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-card/40 px-6 backdrop-blur">
      {/* En móvil no hay barra lateral, así que la marca de la empresa vive
          aquí. Antes decía "Evoelution" a secas, en el portal de cualquiera. */}
      <div className="min-w-0 lg:hidden">
        <TenantMark brand={brand} />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {/* Sitio fijo en toda la aplicación: es lo que lo vuelve costumbre. */}
        <AnalysisAssistant />
        {campana}
        {/* Junto al tema: los dos son cómo se VE el sistema, no qué hace. */}
        <DensidadToggle inicial={densidad} />
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
