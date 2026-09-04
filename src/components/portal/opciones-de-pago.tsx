import { CreditCard, Headset, Sparkles } from "lucide-react";

/**
 * Los dos caminos para empezar a pagar.
 *
 * ── VIVE EN SU PROPIO ARCHIVO ─────────────────────────────────────────────
 *
 * Estaba exportado desde el `page.tsx` del muro de suscripción, y eso es una
 * mala idea en el App Router: un archivo de página tiene un contrato de
 * exportaciones —`default`, `metadata`, `revalidate`…— y colgarle una más lo
 * convierte en un módulo que hace dos cosas. Las dos pantallas que lo usan lo
 * importan de aquí.
 *
 * ── EL DE LA TARJETA SOLO APARECE SI EXISTE ───────────────────────────────
 *
 * `SUSCRIPCION_PAGO_URL` es un enlace de pago del proveedor. Sin esa variable no
 * se pinta: un botón de pagar que no lleva a ningún sitio es el peor control
 * posible en la pantalla que le pide dinero a alguien.
 *
 * ── Y SE DICE QUE NO LLEVA FACTURA ────────────────────────────────────────
 *
 * Porque una empresa mexicana la necesita para deducir el gasto, y descubrirlo
 * DESPUÉS de pagar convierte una venta en un reclamo. Quien necesite CFDI tiene
 * el otro camino, que es el que lo emite.
 */
export function OpcionesDePago({
  /** En la pestaña de suscripción el gesto se llama «Upgrade»; en el muro, no. */
  upgrade = false,
}: {
  upgrade?: boolean;
}) {
  const pagoUrl = process.env.SUSCRIPCION_PAGO_URL;

  return (
    <>
      {pagoUrl && (
        <a
          href={pagoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3.5 transition-colors hover:border-primary hover:bg-primary/10"
        >
          {upgrade ? (
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <CreditCard className="mt-0.5 size-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {upgrade ? "Upgrade · pagar con tarjeta" : "Paga con tarjeta de crédito"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Se activa al instante.{" "}
              <span className="font-medium text-warning">
                Esta vía no emite factura
              </span>
              : si la necesitas, usa la opción de abajo.
            </span>
          </span>
        </a>
      )}

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
    </>
  );
}
