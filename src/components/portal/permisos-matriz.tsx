"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  MODULOS,
  MODULO_INFO,
  NIVELES,
  NIVEL_AYUDA,
  NIVEL_LABELS,
  nivelDelRol,
  type Ajustes,
  type Modulo,
  type Nivel,
} from "@/lib/permisos";
import type { AssignableRole } from "@/lib/roles";

/**
 * Acceso por módulo de UNA persona.
 *
 * ── LO QUE ENSEÑA ES EL RESULTADO, NO EL AJUSTE ───────────────────────────
 *
 * Cada renglón dice qué va a poder hacer esa persona en ese módulo, y el valor
 * por omisión —«Según el rol»— muestra al lado lo que el rol le da HOY. Es la
 * diferencia entre configurar y adivinar: sin esa pista, poner «Sin acceso» en
 * Compras parece un cambio aunque el rol ya no diera Compras, y quitarlo parece
 * inofensivo aunque estuviera abriendo una puerta.
 *
 * Por eso el selector reacciona al rol elegido arriba en el mismo formulario:
 * cambiar de agente a vendedor cambia lo que dice cada renglón sin guardar
 * nada. Lo que se está decidiendo es el acceso final, y el rol es la mitad de
 * esa cuenta.
 *
 * ── «SEGÚN EL ROL» NO ES UN NIVEL MÁS ─────────────────────────────────────
 *
 * Es la ausencia de ajuste, y viaja como cadena vacía. Guardarlo como si fuera
 * un nivel dejaría a la cuenta con una fotografía congelada de la plantilla del
 * día que se editó: cambiar después lo que da un rol no alcanzaría a nadie que
 * ya estuviera dado de alta. Ver `Ajustes` en `lib/permisos.ts`.
 *
 * ── ESTO NO SUSTITUYE AL GUARDIA ──────────────────────────────────────────
 *
 * Lo que se elige aquí lo vuelve a comprobar el servidor en cada pantalla y en
 * cada acción, con la misma regla. Esta pantalla decide; no defiende.
 */
export function PermisosMatriz({
  rol,
  ajustes,
}: {
  /** El rol elegido AHORA en el formulario, no el guardado. Ver arriba. */
  rol: AssignableRole;
  ajustes: Ajustes;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(MODULOS.map((m) => [m, ajustes[m] ?? ""])),
  );

  const poner = (m: Modulo, v: string) =>
    setValores((prev) => ({ ...prev, [m]: v }));

  const ajustados = MODULOS.filter((m) => valores[m]).length;

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Acceso por módulo</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            El rol marca el punto de partida. Aquí se ajusta módulo por módulo
            para esta persona, sin tener que subirle el rol.
            {ajustados > 0 && (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  {ajustados} ajustado{ajustados === 1 ? "" : "s"}
                </span>
                .
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {MODULOS.map((m) => {
          const delRol = nivelDelRol(rol, m);
          const puesto = valores[m] as Nivel | "";
          const efectivo: Nivel = puesto || delRol;
          return (
            <div key={m} className="grid gap-1.5 sm:grid-cols-[1fr_13rem] sm:items-center sm:gap-3">
              <div className="min-w-0">
                <label htmlFor={`permiso.${m}`} className="text-sm font-medium">
                  {MODULO_INFO[m].label}
                </label>
                <p className="text-xs text-muted-foreground">
                  {MODULO_INFO[m].detalle}
                </p>
              </div>
              <select
                id={`permiso.${m}`}
                name={`permiso.${m}`}
                value={puesto}
                onChange={(e) => poner(m, e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {/* El valor por omisión dice qué da el rol, para que elegirlo
                    no sea a ciegas. */}
                <option value="">Según el rol · {NIVEL_LABELS[delRol]}</option>
                {NIVELES.map((n) => (
                  <option key={n} value={n}>
                    {NIVEL_LABELS[n]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground sm:col-start-2">
                {NIVEL_AYUDA[efectivo]}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
