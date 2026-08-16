import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { ConsoleChrome } from "@/components/console/console-chrome";

/**
 * Cáscara de la CONSOLA DE ASTRAION.
 *
 * Deliberadamente separada del layout de `(app)`, que es la aplicación de UNA
 * empresa. Hasta ahora la consola vivía dentro de esa cáscara y salía con la
 * barra lateral de Evoelution al lado —embudo, tickets, refacciones—, lo que
 * hacía ver dos planos distintos como si fueran el mismo producto:
 *
 *   Astraion            → todas las empresas          ← esta cáscara
 *   └─ Evoelution       → sus tickets, sus clientes   ← la cáscara de (app)
 *
 * Confundirlos no es un problema estético: lleva a creer que "administro mi
 * empresa" y "estoy dentro de la de un cliente" son lo mismo.
 */
export default async function ConsoleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect({ href: "/login", locale });
  }
  // El rol de plataforma es otra dimensión que el rol dentro de una empresa:
  // el dueño de una cuenta manda en la suya y no debe ver esta capa siquiera.
  // Se le manda a `/entrar` y no a un `/dashboard` suelto, porque ese ya no
  // existe: sin empresa en la URL no hay portal al que llegar.
  if (!session!.user.platformRole) {
    redirect({ href: "/entrar", locale });
  }

  return (
    <SessionProvider session={session}>
      <ConsoleChrome
        locale={locale}
        name={session!.user.name}
        email={session!.user.email}
        platformRole={session!.user.platformRole}
      >
        {children}
      </ConsoleChrome>
    </SessionProvider>
  );
}
