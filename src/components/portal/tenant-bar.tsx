import { ArrowLeft, Building2, ShieldAlert } from "lucide-react";
import { exitTenant } from "@/lib/actions/platform";
import { cn } from "@/lib/utils";

/**
 * Franja de contexto: en qué empresa estás parado y cómo se sale.
 *
 * Solo la ve el personal de Astraion, y es la pieza que faltaba para cerrar el
 * ciclo: hasta ahora se podía ENTRAR a la empresa de un cliente desde la
 * consola y no había manera de volver salvo borrar la cookie a mano.
 *
 * Va arriba de todo y en cada página del portal, no solo en la consola: el
 * momento peligroso no es cuando miras la lista de empresas, es cuando llevas
 * veinte minutos dentro de los tickets de un cliente y ya olvidaste de quién
 * son los datos que estás leyendo.
 */
export async function TenantBar({
  tenantName,
  impersonated,
  locale,
}: {
  tenantName: string;
  impersonated: boolean;
  locale: string;
}) {
  return (
    <div
      className={cn(
        "no-print flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-6 py-2 text-sm",
        impersonated
          ? "border-warning/40 bg-warning/10 text-warning-foreground"
          : "border-border bg-secondary/50",
      )}
    >
      {impersonated ? (
        <ShieldAlert className="size-4 shrink-0 text-warning" />
      ) : (
        <Building2 className="size-4 shrink-0 text-primary" />
      )}

      <span>
        {impersonated ? "Estás dentro de " : "Trabajando en "}
        <span className="font-semibold">{tenantName}</span>
        {impersonated && " como personal de Astraion. El acceso quedó registrado."}
      </span>

      {/* Exento del guardia de solo lectura: no escribe en la empresa,
          borra una cookie. Sin esto, el guardia atraparía la salida y dejaría
          al operador encerrado dentro del cliente. Ver `SoloLectura`. */}
      <form action={exitTenant} className="ml-auto" data-permitido>
        <input type="hidden" name="locale" value={locale} />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <ArrowLeft className="size-3.5" />
          Volver a Astraion
        </button>
      </form>
    </div>
  );
}
