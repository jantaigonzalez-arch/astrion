import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * El 404 de TODA la aplicación, con su propio `<html>` y `<body>`.
 *
 * ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────
 *
 * El `<html>`/`<body>` de este proyecto vive en `app/[locale]/layout.tsx`,
 * porque depende del idioma: el atributo `lang`, la fuente y la clase del tema
 * se resuelven ahí. `app/layout.tsx` es un pasamanos que solo devuelve
 * `children`.
 *
 * Eso funciona para todas las rutas del sitio, y deja de funcionar para las que
 * NO son ninguna ruta. Una URL que no coincide con nada no entra por
 * `[locale]`, así que Next compone el 404 con el layout raíz —que no tiene
 * `<html>` ni `<body>`— y en vez de una página de «no existe» sale un error de
 * ejecución: «Missing <html> and <body> tags in the root layout». El mensaje no
 * menciona el 404 por ningún lado, así que se busca en el sitio equivocado.
 *
 * Es una fragilidad que llevaba ahí desde siempre y que nadie había tocado,
 * porque hacía falta pedir una URL inexistente para verla. Salió a la luz al
 * retirar `/admin/ml`: el enlace seguía en el menú, alguien lo pulsó, y la
 * aplicación entera respondió con un error de framework.
 *
 * La documentación de esta versión describe el caso con nombre propio: cuando
 * el layout raíz se define con segmentos dinámicos de primer nivel, no hay un
 * layout único con el que componer un 404 consistente, y para eso existe
 * `global-not-found` — habilitado con `experimental.globalNotFound`.
 *
 * ── EL IDIOMA ──────────────────────────────────────────────────────────────
 *
 * No recibe `params`, así que no puede saber el idioma: por definición, la URL
 * que llegó aquí no coincidió con `[locale]`. Va en español, que es el idioma
 * por omisión del producto, y sin negociar cabeceras — una página de error que
 * hace trabajo para adivinar es una página de error que también puede fallar.
 *
 * Solo la fuente sans y nada de tema: es la única pantalla del sistema que
 * tiene que renderizar aunque el resto esté mal.
 */

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "No encontramos esa página · Astraion",
  description: "La dirección no corresponde a ninguna pantalla del sistema.",
};

export default function GlobalNotFound() {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            No encontramos esa página
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            La dirección no corresponde a ninguna pantalla del sistema. Puede que
            el enlace esté viejo, o que la pantalla se haya movido.
          </p>
          {/* `Link` de `next/link` y NO el de `@/lib/nav`: el segundo resuelve
              el prefijo de empresa y de idioma, y este archivo cuelga fuera de
              `[locale]`, donde ese contexto no existe. Un enlace absoluto a la
              raíz siempre lleva a algún sitio válido; uno construido a medias,
              no. */}
          <Link
            href="/"
            className="mt-6 inline-flex w-fit items-center rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Ir al inicio
          </Link>
        </main>
      </body>
    </html>
  );
}
