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

/**
 * Orígenes de DESARROLLO permitidos.
 *
 * Next bloquea las peticiones a los recursos internos de dev (`/_next/*`, HMR)
 * cuando llegan desde un host que no es localhost. Probar el modo subdominio
 * choca de frente con eso, y el síntoma es de los peores que hay: la página se
 * renderiza perfecta en el servidor, el JavaScript nunca carga, y el formulario
 * de acceso —que evita el envío nativo con `preventDefault` en el cliente— cae
 * al comportamiento por omisión del navegador: GET, con la contraseña escrita
 * en la barra de direcciones. Parece "no entra" y en realidad es "no hidrató".
 *
 * Solo afecta a `next dev`. En producción sirve nginx y esto no interviene.
 * Se deriva de ROOT_DOMAIN para que no haya una lista que mantener a mano.
 */
const devRoot = process.env.ROOT_DOMAIN?.trim().toLowerCase();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  allowedDevOrigins: devRoot ? [devRoot, `*.${devRoot}`] : [],

  experimental: {
    // La importación masiva de cuentas por pagar sube el archivo por una Server
    // Action, y el tope por omisión es 1 MB. Un CSV de mil facturas cabe de
    // sobra, pero un lote de CFDI no: cada XML pesa entre 5 y 15 KB y una
    // descarga masiva de un mes son varios cientos de archivos.
    //
    // Con el tope por omisión el fallo es feo — la acción revienta antes de
    // ejecutarse y el usuario ve un error genérico sin relación con lo que hizo.
    serverActions: { bodySizeLimit: "12mb" },
  },

  /**
   * Polars se carga con el `require` de Node, no se empaqueta.
   *
   * Trae un binario nativo (`.node`), y Turbopack no puede meterlo en un chunk
   * ESM: el build falla con «non-ecmascript placeable asset». Entró al grafo de
   * la aplicación cuando el laboratorio empezó a congelar sus conjuntos de
   * entrenamiento —`lab.ts` lo importa, y la pantalla de ML importa `lab.ts`—.
   *
   * Declararlo externo es la salida correcta y no un parche: un binario
   * compilado por plataforma no tiene nada que hacer dentro de un bundle de
   * JavaScript. El trazado de `output: standalone` lo sigue copiando a la
   * imagen porque la dependencia es real; lo único que cambia es que se
   * resuelve en tiempo de ejecución.
   */
  serverExternalPackages: ["nodejs-polars"],

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
