import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSignups } from "@/lib/data/platform";
import { SignupInbox } from "@/components/portal/signup-inbox";
import { isPlatformSuperadmin } from "@/lib/platform-session";

/**
 * Solicitudes de alta: empresas que pidieron entrar y esperan una decisión.
 *
 * Sección propia y solo del superadministrador, que es quien aprueba. A soporte
 * ni siquiera se le pinta el renglón en la navegación; esta comprobación es la
 * que impide que llegue escribiendo la dirección.
 *
 * `notFound` y no un aviso de permiso: es la misma postura que la pantalla de
 * un tablero: quien no puede aprobar un alta tampoco tiene por qué saber
 * cuántas hay pendientes.
 */
export default async function SolicitudesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Ver la nota de `empresas/page.tsx`: layout y página corren en paralelo.
  const session = await auth();
  if (!session?.user) return null;
  // De la BASE y no del token: ver `platform-session.ts`. Un superadministrador
  // degradado seguía aprobando altas hasta que su JWT caducara.
  if (!(await isPlatformSuperadmin())) notFound();

  const signups = await getSignups();
  const pendientes = signups.filter((s) => s.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Solicitudes de alta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pendientes === 0
            ? "Nada pendiente de revisar."
            : `${pendientes} esperando decisión · ${signups.length} en total`}
        </p>
      </div>

      <SignupInbox rows={signups} />
    </div>
  );
}
