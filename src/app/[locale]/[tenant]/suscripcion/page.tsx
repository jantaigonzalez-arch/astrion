import { setRequestLocale } from "next-intl/server";
import { Lock } from "lucide-react";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { redirectInTenant } from "@/lib/nav-server";
import { TenantMark } from "@/components/portal/tenant-mark";
import { PoweredByAstraion } from "@/components/portal/powered-by";
import { Card } from "@/components/ui/card";
import { planDe } from "@/lib/suscripcion";
import { OpcionesDePago } from "@/components/portal/opciones-de-pago";
import { CerrarSesion } from "@/components/portal/cerrar-sesion";

/**
 * La pantalla de quien ya no puede entrar.
 *
 * ── VIVE FUERA DE `(app)` A PROPÓSITO ─────────────────────────────────────
 *
 * Es hermana de `/acceso` y no una pantalla más del portal. Si estuviera dentro
 * la alcanzaría el mismo guardia que manda aquí, y sería un bucle: cada intento
 * de ver por qué no se entra redirigiría a la pantalla que lo explica.
 *
 * ── NO ES UN ERROR, ES UNA CUENTA ─────────────────────────────────────────
 *
 * Sin números rojos ni tono de sanción. Quien llega aquí es un cliente al que
 * se le acabó una prueba —o cuya empresa no pagó— y probablemente ni sepa que
 * había una fecha. La pantalla dice qué pasó, qué se hace, y deja los dos
 * caminos a la vista.
 */
export default async function SuscripcionPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);

  const ctx = await getTenantContext();
  // Sin sesión no hay nada que contar: a la puerta.
  if (!ctx) await redirectInTenant("/acceso", locale);

  // Al corriente: esta pantalla no es para ti. Que exista y se pueda visitar
  // no significa que tenga sentido verla trabajando con normalidad.
  if (ctx!.suscripcion.entra) await redirectInTenant("/dashboard", locale);

  const marca = await getTenantBrand(tenant);
  const plan = planDe(ctx!.plan);
  const e = ctx!.suscripcion;

  const titulo =
    e.clave === "vencida"
      ? "Se terminó el periodo de prueba"
      : e.clave === "cancelada"
        ? "Esta cuenta está dada de baja"
        : "El acceso está pausado";

  const explicacion =
    e.clave === "vencida"
      ? "Tus datos están intactos y te esperan. Solo hace falta activar la suscripción para volver a entrar."
      : e.clave === "cancelada"
        ? "La cuenta se dio de baja. Si fue un error o quieres reactivarla, escríbenos."
        : "El acceso quedó en pausa. En cuanto se regularice vuelve a abrirse, con todo como lo dejaste.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-12">
      <div className="w-full max-w-md">
        {marca && <TenantMark brand={marca} />}

        <Card className="mt-6 p-7">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <Lock className="size-5 text-muted-foreground" />
          </div>

          <h1 className="mt-4 text-xl font-semibold tracking-tight">{titulo}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {explicacion}
          </p>

          {plan && (
            <p className="mt-4 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
              Plan <span className="font-medium text-foreground">{plan.nombre}</span>{" "}
              · {plan.escalon} ·{" "}
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(plan.precioUsd)}{" "}
              al mes <span className="text-muted-foreground">+ IVA</span>
            </p>
          )}

          <div className="mt-5 space-y-3">
            <OpcionesDePago />
          </div>
        </Card>

        {/*
          La salida. Quien llega aquí puede pertenecer a más de una empresa —una
          consultora que atiende a dos laboratorios—, así que cerrar sesión no es
          rendirse: es la única forma de ir a la otra.
        */}
        <div className="mt-4 flex justify-center">
          <CerrarSesion />
        </div>

        <div className="mt-8 flex justify-center">
          <PoweredByAstraion />
        </div>
      </div>
    </main>
  );
}
