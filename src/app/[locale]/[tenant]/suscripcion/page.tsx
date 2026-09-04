import { setRequestLocale } from "next-intl/server";
import { CreditCard, Headset, Lock } from "lucide-react";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { redirectInTenant } from "@/lib/nav-server";
import { TenantMark } from "@/components/portal/tenant-mark";
import { PoweredByAstraion } from "@/components/portal/powered-by";
import { Card } from "@/components/ui/card";
import { planDe } from "@/lib/suscripcion";
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
              Plan <span className="font-medium text-foreground">{plan.nombre}</span> ·{" "}
              {new Intl.NumberFormat("es-MX", {
                style: "currency",
                currency: "MXN",
                maximumFractionDigits: 0,
              }).format(plan.precioMxn)}{" "}
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

/**
 * Los dos caminos para pagar.
 *
 * ── EL DE LA TARJETA SOLO APARECE SI EXISTE ───────────────────────────────
 *
 * `SUSCRIPCION_PAGO_URL` es un enlace de pago del proveedor. Sin esa variable no
 * se pinta el botón: un botón de pagar que no lleva a ningún sitio es el peor
 * control posible en la pantalla que le pide dinero a alguien.
 *
 * ── Y SE DICE QUE NO LLEVA FACTURA ────────────────────────────────────────
 *
 * Porque una empresa mexicana la necesita para deducir el gasto, y descubrirlo
 * DESPUÉS de pagar convierte una venta en un reclamo. Quien necesite CFDI tiene
 * el otro camino, que es el que lo emite.
 */
export function OpcionesDePago() {
  const pagoUrl = process.env.SUSCRIPCION_PAGO_URL;

  return (
    <>
      <a
        href="mailto:hola@astraion.com?subject=Activar%20mi%20suscripci%C3%B3n"
        className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-secondary/40"
      >
        <Headset className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Comunícate con tu agente
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Te ayudamos a activarla y recibes tu factura fiscal.
          </span>
        </span>
      </a>

      {pagoUrl && (
        <a
          href={pagoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-secondary/40"
        >
          <CreditCard className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Paga con tarjeta de crédito
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Se activa al instante.{" "}
              <span className="font-medium text-warning">
                Esta vía no emite factura
              </span>
              : si la necesitas, usa la opción de arriba.
            </span>
          </span>
        </a>
      )}
    </>
  );
}
