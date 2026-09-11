"use client";

import { useLinkContext, useRouter, useTenant } from "@/lib/nav";
import { tenantHref } from "@/lib/tenant-path";

/**
 * UN BUSCADOR QUE MANDA A LA URL, CON EL PREFIJO DE LA EMPRESA.
 *
 * `<form method="get" action="/admin/clientes">` parece lo más simple, y en
 * producción daba 404: allí el portal va en modo path —`/evoelution/admin/…`—
 * y un `action` crudo pierde el prefijo, igual que un `<a href>` crudo (por eso
 * existe `Link`). Se vio en Clientes, ya desplegado, al repetir el mismo
 * formulario en el inventario: buscar mandaba a una página que no existe.
 *
 * Aquí el envío pasa por el `useRouter` del portal, que prefija la empresa y el
 * idioma igual que un enlace, y navega sin recargar. El `action` resuelto se
 * queda de todos modos para quien no tenga JavaScript.
 *
 * Los campos vacíos no viajan: `?q=` en la URL no dice nada y ensucia el enlace.
 */
export function FormularioGet({
  action,
  className,
  children,
}: {
  /** Ruta DENTRO de la empresa, como en `Link`: `/admin/clientes`. */
  action: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const tenant = useTenant();
  const { apex } = useLinkContext();

  return (
    <form
      method="get"
      action={tenantHref(action, { tenant, apex })}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        for (const [k, v] of new FormData(e.currentTarget)) {
          if (typeof v === "string" && v.trim()) p.set(k, v.trim());
        }
        const cola = p.toString();
        router.push(cola ? `${action}?${cola}` : action);
      }}
    >
      {children}
    </form>
  );
}
