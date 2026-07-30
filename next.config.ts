import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Hosts permitidos para <Image> remoto.
 *
 * Antes esto era `hostname: "**"`, que acepta cualquier host HTTPS: en
 * producción eso convierte al optimizador de Next en un proxy de imágenes
 * abierto — cualquiera puede servir imágenes ajenas a través de tu servidor
 * y a tu costo de CPU y ancho de banda.
 *
 * Hoy la lista está vacía y no rompe nada: no hay una sola imagen remota en
 * el código ni en la base (equipment.photo, brands.logo y products.image
 * están todas vacías). Las fotos de equipos son rutas relativas del mismo
 * origen (/uploads/…) y no pasan por el optimizador remoto.
 *
 * Para habilitar un host: NEXT_PUBLIC_IMAGE_HOSTS="cdn.ejemplo.com,otro.com"
 */
const remoteImageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Empaqueta en .next/standalone el servidor con solo las dependencias que
  // realmente usa, para que la imagen Docker no cargue todo node_modules.
  output: "standalone",

  // Hay varios package-lock.json en el árbol de repos y Next estaba tomando
  // el de ~/Documents/Repos como raíz del workspace. Fijarla evita ese
  // warning y que el build arrastre archivos de fuera del proyecto.
  turbopack: {
    root: path.join(__dirname),
  },

  // `uploads.ts` escribe archivos (mkdir/writeFile), que es literalmente su
  // trabajo. El trazador del build standalone ve esas operaciones, no puede
  // saber a qué rutas apuntan y por las dudas arrastra el proyecto entero:
  // sin esta lista, la imagen terminaba con docs/, deploy/, el propio
  // Dockerfile y hasta dev.log adentro.
  //
  // Nada de esto se usa en runtime. Las migraciones se excluyen a propósito:
  // las aplica el stage `migrator` del Dockerfile, que copia drizzle/ aparte.
  outputFileTracingExcludes: {
    "/*": [
      "docs/**/*",
      "deploy/**/*",
      "drizzle/**/*",
      "scripts/**/*",
      "public/uploads/**/*",
      "**/*.md",
      "dev.log",
      "Dockerfile",
      "docker-compose*.yml",
      ".dockerignore",
      "*.tsbuildinfo",
    ],
  },

  images: {
    remotePatterns: remoteImageHosts.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
  },
};

export default withNextIntl(nextConfig);
