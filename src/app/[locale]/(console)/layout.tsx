import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { ConsoleChrome } from "@/components/console/console-chrome";
import { getSignups } from "@/lib/data/platform";
import { currentPlatformRole } from "@/lib/platform-session";

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

  /*
    Y la cuenta tiene que seguir viva HOY.

    `kind` viene del token, o sea de la fotografía del día que entró: dice de
    qué tabla salió la sesión y eso no cambia nunca, pero tampoco dice si la
    cuenta sigue activa. Con sesión JWT no hay tabla de sesiones que invalidar,
    así que desactivar a un operador en `platform_users` no lo sacaba de aquí:
    seguía entrando a la consola, y desde ella a la empresa de cualquier
    cliente, hasta que su token caducara —treinta días por omisión—.

    `currentPlatformRole()` lo pregunta a la base. Devuelve `null` si la cuenta
    se borró o se desactivó, y ésta es la puerta donde eso tiene que pesar: las
    páginas de adentro comprueban si es superadministrador, no si puede estar.

    A `/consola` y no a `/entrar`: quien llega aquí vino a operar, y su cuenta
    de operador es la que dejó de servir.
  */
  const rolDePlataforma = await currentPlatformRole();
  if (!rolDePlataforma) {
    redirect({ href: "/consola", locale });
  }

  const isAdminDePlataforma = rolDePlataforma === "superadmin";

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
        platformRole={rolDePlataforma}
        solicitudesPendientes={pendientes}
      >
        {children}
      </ConsoleChrome>
    </SessionProvider>
  );
}
