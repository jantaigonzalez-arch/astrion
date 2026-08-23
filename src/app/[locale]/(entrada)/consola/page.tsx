import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { AstraionLogo } from "@/components/shared/astraion-logo";
import { LoginForm } from "@/components/portal/login-form";

/**
 * La puerta de quien OPERA Astraion.
 *
 * ── POR QUÉ ES OTRA PÁGINA Y NO UNA CASILLA EN `/login` ────────────────────
 *
 * Porque autentica contra otra tabla. `platform_users` y `users` no comparten
 * nada —ni siquiera el espacio de correos: la misma dirección puede estar en
 * las dos, y son dos cuentas de la misma persona para dos trabajos—. Un solo
 * formulario tendría que decidir en cuál buscar, y esa decisión no la puede
 * tomar el navegador ni el correo escrito: la toma la puerta por la que se
 * entra. Ver la cabecera de `lib/auth.ts`.
 *
 * ── NO SE ANUNCIA ─────────────────────────────────────────────────────────
 *
 * No hay enlace a esta página desde `/login` ni desde el sitio público. No es
 * seguridad —la dirección es adivinable y la protección es la contraseña— sino
 * higiene: un enlace «acceso de personal» en la puerta de los clientes invita a
 * probar suerte y no le sirve a nadie que deba estar aquí. El camino inverso sí
 * existe, porque quien llega por error necesita salir.
 */
export default async function ConsolaLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Ya autenticado como operador: esta pantalla no tiene nada que ofrecerle.
  // Se comprueba `kind` y no `platformRole` porque son la misma pregunta hecha
  // bien y hecha a medias — un token de inquilino nunca lleva rol, pero apoyarse
  // en eso es apoyarse en una consecuencia en vez de en el hecho.
  const session = await auth();
  if (session?.user?.kind === "platform") {
    redirect({ href: "/platform", locale });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
      {/* Reflejo frío y no el degradado de marca de `/login`: son dos puertas y
          tienen que sentirse distintas desde antes de leer el título. Quien
          administra la plataforma y quien la usa no deben confundir en cuál
          están escribiendo su contraseña. */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-[720px] -translate-x-1/2 rounded-full bg-signal/10 blur-[120px]" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center">
          <AstraionLogo />
        </Link>
        <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-2xl shadow-primary/5 backdrop-blur">
          <LoginForm brand="consola" provider="platform" destination="/platform" />
        </div>
      </div>
    </div>
  );
}
