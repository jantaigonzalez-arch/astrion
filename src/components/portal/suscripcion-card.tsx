import { CalendarClock, CircleCheck, Gift, Orbit } from "lucide-react";
import { Card } from "@/components/ui/card";
import { planDe, precioDelPlan, type EstadoSuscripcion } from "@/lib/suscripcion";
import { OpcionesDePago } from "@/components/portal/opciones-de-pago";

/**
 * La suscripción, en su propia pestaña de Configuración.
 *
 * ── PESTAÑA Y NO TARJETA SUELTA ───────────────────────────────────────────
 *
 * Vivía como una tarjeta más entre marca y tarifas, y ahí competía con lo que
 * la empresa entra a hacer todos los días. En su pestaña se encuentra cuando se
 * la busca y no estorba cuando no —que es la definición de discreto que se
 * pidió—, y además hay sitio para decir lo que incluye el plan sin apretar.
 *
 * Va la ÚLTIMA de las pestañas por lo mismo: es de la cuenta, no de cómo
 * trabaja la empresa.
 *
 * ── «PRUEBA GRATUITA», CON ESAS PALABRAS ──────────────────────────────────
 *
 * No «periodo de evaluación» ni «trial». Quien la está usando tiene que
 * entender de un vistazo que hoy no está pagando y que eso tiene fecha; las dos
 * mitades, porque decir solo «gratis» esconde la segunda.
 */
export function SuscripcionCard({
  estado,
  plan,
}: {
  estado: EstadoSuscripcion;
  plan: string;
}) {
  const p = planDe(plan);
  const enPrueba = estado.clave === "prueba" || estado.clave === "prueba-abierta";

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Orbit className="size-5 text-primary" />
              <h2 className="font-semibold">Tu plan</h2>
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-2xl font-semibold tracking-tight">
                {p ? p.nombre : "Evaluación"}
              </span>
              {p && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {p.escalon}
                </span>
              )}
            </div>
            {p && <p className="mt-1.5 text-sm text-muted-foreground">{p.lema}</p>}
          </div>

          {p && (
            <div className="text-right">
              <div className="text-2xl font-semibold tracking-tight">
                {precioDelPlan(p)}
              </div>
              <div className="text-xs text-muted-foreground">al mes + IVA</div>
            </div>
          )}
        </div>

        {/* ── Dónde estás hoy ── */}
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 px-3.5 py-3 text-sm">
          {estado.clave === "activa" ? (
            <>
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <span className="font-medium">Suscripción activa.</span> No
                tienes que hacer nada.
              </span>
            </>
          ) : enPrueba ? (
            <>
              <Gift className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Estás en tu prueba gratuita.</span>{" "}
                {estado.clave === "prueba" ? (
                  <>
                    Te quedan{" "}
                    <span className="font-medium text-foreground">
                      {estado.dias} día{estado.dias === 1 ? "" : "s"}
                    </span>
                    , hasta el{" "}
                    {new Intl.DateTimeFormat("es-MX", {
                      day: "numeric",
                      month: "long",
                    }).format(estado.hasta)}
                    . Tienes el sistema completo, sin límites.
                  </>
                ) : (
                  <>Sin fecha de término. Tienes el sistema completo, sin límites.</>
                )}
              </span>
            </>
          ) : (
            <>
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>El acceso está pausado.</span>
            </>
          )}
        </div>
      </Card>

      {/*
        El paso a suscripción. Solo mientras NO se esté pagando: ofrecerle
        «Upgrade» a quien ya está al corriente es pedirle que pague dos veces.
      */}
      {estado.clave !== "activa" && (
        <Card className="p-6">
          <h2 className="font-semibold">Suscribirte</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {estado.clave === "prueba" || estado.clave === "prueba-abierta"
              ? "Cuando quieras, y sin esperar a que se acabe la prueba: los días que te queden no se pierden."
              : "Reactiva el acceso. Tus datos siguen intactos."}
          </p>
          <div className="mt-4 space-y-3">
            <OpcionesDePago upgrade />
          </div>
        </Card>
      )}
    </div>
  );
}
