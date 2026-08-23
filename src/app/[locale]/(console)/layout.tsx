import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { ConsoleChrome } from "@/components/console/console-chrome";
import { getSignups } from "@/lib/data/platform";

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
  // Sin sesión, a la puerta de la CONSOLA y no a `/login`: quien viene a
  // `/platform` viene a operar, y mandarlo al formulario de los clientes lo
  // pondría a escribir su contraseña de operador contra la tabla equivocada,
  // donde no entraría nunca y sin saber por qué.
  if (!session?.user) {
    redirect({ href: "/consola", locale });
  }
  // Y con sesión, tiene que ser una sesión de PLATAFORMA. Se mira `kind`, que
  // es de qué tabla salió, y no si trae rol: el rol es una consecuencia de eso
  // —`auth.ts` no lo copia en tokens de inquilino— y colgar el permiso de la
  // consecuencia es cómo esta capa acabó colgando de una columna nula.
  //
  // Un usuario de empresa va a `/entrar` y no a un `/dashboard` suelto: sin
  // empresa en la URL no hay portal al que llegar.
  if (session!.user.kind !== "platform") {
    redirect({ href: "/entrar", locale });
  }

  const isAdminDePlataforma = session!.user.platformRole === "superadmin";

  // El punto sobre «Solicitudes» cuelga del layout y no de la página porque
  // tiene que verse desde CUALQUIER sección: enterarse de que hay una empresa
  // esperando solo al pasar por el inicio es enterarse tarde. Solo se consulta
  // para quien puede aprobarlas — a soporte ni se le pinta el renglón.
  const pendientes = isAdminDePlataforma
    ? (await getSignups()).filter((s) => s.status === "pending").length
    : 0;

  return (
    <SessionProvider session={session}>
      <ConsoleChrome
        locale={locale}
        name={session!.user.name}
        email={session!.user.email}
        platformRole={session!.user.platformRole}
        solicitudesPendientes={pendientes}
      >
        {children}
      </ConsoleChrome>
    </SessionProvider>
  );
}
