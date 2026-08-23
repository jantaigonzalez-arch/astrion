import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { platformUsers, users } from "@/lib/db/platform";
import { ROOT_DOMAIN } from "@/lib/tenancy/host";

/**
 * La sesión dice QUIÉN es la persona, no qué puede hacer.
 *
 * Aquí vivía `Role`, un rol global: la misma persona era "admin" en todas las
 * empresas o en ninguna. Se fue con la columna `users.role`. Lo que puede hacer
 * alguien depende de la empresa en la que está parado y se pregunta con
 * `currentRole()` (`tenancy/context.ts`), que lee su membresía.
 *
 * ── DOS PUERTAS, Y NO UN FORMULARIO QUE BUSCA EN DOS SITIOS ────────────────
 *
 * Quien opera Astraion vive en `platform_users`, una tabla aparte de quien la
 * usa. Cada tabla tiene su proveedor y su pantalla: `/login` entra al portal de
 * una empresa, `/consola` entra a la consola. Ninguno de los dos mira la tabla
 * del otro.
 *
 * Un solo formulario que probara primero una tabla y luego la otra sería más
 * cómodo y devolvería el problema entero: el mismo correo puede existir en las
 * dos —son dos cuentas de la misma persona para dos trabajos— y «cuál de las
 * dos entra» pasaría a depender del orden en que se consultan. Peor: probar la
 * contraseña de un operador contra la tabla de clientes es exactamente cómo se
 * descubre que una funciona en la otra.
 *
 * `kind` es lo que la sesión lleva para no volver a mezclarlas. No se deduce de
 * si `platformRole` es nulo, porque eso era la vieja columna con otro nombre.
 */

/** Rol de PLATAFORMA. Solo significa algo cuando `kind === "platform"`. */
export type PlatformRole = "superadmin" | "support" | null;

/** De qué tabla salió esta sesión. Ver la nota de arriba. */
export type SessionKind = "tenant" | "platform";

/** El id del proveedor de la consola. `signIn(PLATFORM_PROVIDER, …)`. */
export const PLATFORM_PROVIDER = "platform";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      kind: SessionKind;
      platformRole: PlatformRole;
    } & DefaultSession["user"];
  }
  interface User {
    kind?: SessionKind;
    platformRole?: PlatformRole;
  }
}

/**
 * Dominio de la cookie de sesión.
 *
 * Sin esto, el modo subdominio no funciona en absoluto: una cookie escrita en
 * `astraion.com` es de HOST por defecto, así que el navegador no la manda a
 * `evoelution.astraion.com`. Entrar a una empresa desde la consola cerraría la
 * sesión en el salto, y nadie entendería por qué.
 *
 * El punto inicial la comparte con todos los subdominios del producto. Es
 * aceptable porque todos los sirve esta misma aplicación: no hay contenido de
 * terceros bajo `*.astraion.com` que pudiera leerla. El día que se ofrezca a un
 * cliente alojar algo suyo ahí, esta decisión hay que revisarla — por eso queda
 * escrito aquí y no como una línea de configuración suelta.
 *
 * `undefined` deja el comportamiento anterior intacto: en desarrollo y en
 * despliegues de un solo dominio, cookie de host y nada que compartir.
 */
const COOKIE_DOMAIN = ROOT_DOMAIN ? `.${ROOT_DOMAIN}` : undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: COOKIE_DOMAIN,
      },
    },
  },
  providers: [
    // La puerta de los inquilinos: quien USA el producto dentro de una empresa.
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!isDbConfigured) return null;
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        const db = getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.passwordHash || !user.active) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name ?? undefined,
          email: user.email,
          kind: "tenant" as const,
          platformRole: null,
        };
      },
    }),

    // La puerta de la consola: quien OPERA Astraion. Otra tabla, otra pantalla.
    Credentials({
      id: PLATFORM_PROVIDER,
      name: "Astraion",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!isDbConfigured) return null;
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        const db = getDb();
        const [op] = await db
          .select()
          .from(platformUsers)
          .where(eq(platformUsers.email, email))
          .limit(1);

        if (!op || !op.passwordHash || !op.active) return null;
        const ok = await bcrypt.compare(password, op.passwordHash);
        if (!ok) return null;

        return {
          id: op.id,
          name: op.name ?? undefined,
          email: op.email,
          kind: "platform" as const,
          platformRole: op.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const u = user as { kind?: SessionKind; platformRole?: PlatformRole };
        token.kind = u.kind ?? "tenant";
        // El rol solo viaja si la sesión es de plataforma. Copiarlo siempre
        // dejaría abierta la puerta a que un token de inquilino lo llevara —
        // que es la columna vieja reencarnada en el JWT.
        token.platformRole = u.kind === "platform" ? (u.platformRole ?? null) : null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.kind = (token.kind as SessionKind) ?? "tenant";
        session.user.platformRole =
          session.user.kind === "platform"
            ? ((token.platformRole as PlatformRole) ?? null)
            : null;
      }
      return session;
    },
  },
});
