import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { users } from "@/lib/db/platform";
import { ROOT_DOMAIN } from "@/lib/tenancy/host";

/**
 * La sesión dice QUIÉN es la persona, no qué puede hacer.
 *
 * Aquí vivía `Role`, un rol global: la misma persona era "admin" en todas las
 * empresas o en ninguna. Se fue con la columna `users.role`. Lo que puede hacer
 * alguien depende de la empresa en la que está parado y se pregunta con
 * `currentRole()` (`tenancy/context.ts`), que lee su membresía.
 *
 * `platformRole` sí vive aquí, y es una dimensión distinta: no habla de una
 * empresa, habla de operar el SaaS por encima de todas.
 */

/**
 * Rol de PLATAFORMA: quien opera el SaaS, por encima de los inquilinos.
 * Null en la enorme mayoría de las cuentas — son usuarios de un cliente.
 */
export type PlatformRole = "superadmin" | "support" | null;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      platformRole: PlatformRole;
    } & DefaultSession["user"];
  }
  interface User {
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
          platformRole: user.platformRole ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.platformRole =
          (user as { platformRole?: PlatformRole }).platformRole ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.platformRole = (token.platformRole as PlatformRole) ?? null;
      }
      return session;
    },
  },
});
