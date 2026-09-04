import { CalendarClock, CircleCheck, Orbit } from "lucide-react";
import { Card } from "@/components/ui/card";
import { convieneAvisar, planDe, type EstadoSuscripcion } from "@/lib/suscripcion";
import { OpcionesDePago } from "@/app/[locale]/[tenant]/suscripcion/page";

/**
 * La suscripción, en la pantalla de ajustes.
 *
 * ── DISCRETA A PROPÓSITO ──────────────────────────────────────────────────
 *
 * Una tarjeta más entre las de configuración, y nada fuera de ahí. Sin franja
 * en la parte de arriba, sin contador en el menú, sin recordatorio al entrar.
 * Quien está probando el sistema tiene treinta días para ver si le sirve, y una
 * pantalla que le recuerde cada mañana que hay que pagar convierte la prueba en
 * una cobranza.
 *
 * Por eso las formas de pago solo aparecen cuando de verdad hacen falta —en la
 * última semana— y no desde el primer día.
 *
 * ── PERO NO INVISIBLE ─────────────────────────────────────────────────────
 *
 * Cerrarle la puerta a alguien que no vio venir nada es peor que un aviso de
 * más. En los últimos siete días la tarjeta lo menciona y ofrece los dos
 * caminos; antes de eso solo informa. Ver `DIAS_PARA_AVISAR`.
 */
export function SuscripcionCard({
  estado,
  plan,
}: {
  estado: EstadoSuscripcion;
  plan: string;
}) {
  const p = planDe(plan);
  const avisar = convieneAvisar(estado);

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Orbit className="size-5 text-primary" />
        <h2 className="font-semibold">Tu suscripción</h2>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-lg font-semibold tracking-tight">
          {p ? `Plan ${p.nombre}` : "Plan de evaluación"}
        </span>
        {p && (
          <span className="text-sm text-muted-foreground">
            {new Intl.NumberFormat("es-MX", {
              style: "currency",
              currency: "MXN",
              maximumFractionDigits: 0,
            }).format(p.precioMxn)}{" "}
            al mes + IVA
          </span>
        )}
      </div>
      {p && <p className="mt-1 text-sm text-muted-foreground">{p.lema}</p>}

      <div className="mt-4 flex items-start gap-2 text-sm">
        {estado.clave === "activa" ? (
          <>
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <span>Activa. No tienes que hacer nada.</span>
          </>
        ) : estado.clave === "prueba" ? (
          <>
            <CalendarClock
              className={`mt-0.5 size-4 shrink-0 ${avisar ? "text-warning" : "text-muted-foreground"}`}
            />
            <span>
              Periodo de prueba:{" "}
              <span className="font-medium">
                {estado.dias} día{estado.dias === 1 ? "" : "s"}
              </span>{" "}
              {estado.dias === 1 ? "restante" : "restantes"}, hasta el{" "}
              {new Intl.DateTimeFormat("es-MX", {
                day: "numeric",
                month: "long",
              }).format(estado.hasta)}
              .
            </span>
          </>
        ) : (
          <>
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>Periodo de prueba, sin fecha de término.</span>
          </>
        )}
      </div>

      {/* Solo en la última semana. Ver la nota de arriba. */}
      {avisar && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Para que no se te corte el acceso, actívala cuando quieras:
          </p>
          <div className="space-y-3">
            <OpcionesDePago />
          </div>
        </div>
      )}
    </Card>
  );
}
