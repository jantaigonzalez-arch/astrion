import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // Español por defecto (mercado principal), inglés para clientes/marcas internacionales.
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
