import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DENSIDAD_COOKIE, densidadGuardada } from "@/lib/densidad";
import { Inter, JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

// Anti-FOUC: aplica el tema antes del primer pintado. Va como <script> crudo en
// el <head> del layout raíz (patrón "Themes" de la doc de Next), no como
// componente que devuelve un <script> — así React no advierte en desarrollo.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { default: t("title"), template: "%s · Astraion" },
    description: t("description"),
    metadataBase: new URL("https://evoelution.com"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Habilita renderizado estático con next-intl.
  setRequestLocale(locale);

  /*
    La densidad de las tablas se resuelve AQUÍ, en el servidor.

    Va en la raíz del documento y no en cada pantalla porque vale para las
    treinta y tres tablas a la vez, y se lee de la cookie y no del navegador
    porque las tablas se dibujan en el servidor: leerla después de montar
    pintaría la densidad por omisión y la corregiría un instante más tarde —el
    salto se ve—. Mismo criterio que el ancho de la barra lateral.
  */
  const densidad = densidadGuardada(
    (await cookies()).get(DENSIDAD_COOKIE)?.value,
  );

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
      data-densidad={densidad}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
