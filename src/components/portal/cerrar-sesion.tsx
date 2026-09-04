"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

/**
 * Cerrar sesión, suelto y sin barra alrededor.
 *
 * Existe porque la pantalla de suscripción vive FUERA del portal y por tanto
 * no tiene la barra superior, que es donde vive el botón de siempre. Y hace
 * falta ahí: quien pertenece a dos empresas —una consultora que atiende a dos
 * laboratorios— necesita poder salir de la que está bloqueada para entrar a la
 * otra. Sin esto, la pantalla sería un callejón.
 */
export function CerrarSesion() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <LogOut className="size-3.5" /> Cerrar sesión
    </button>
  );
}
