"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(next: string) {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5 text-xs font-medium">
      {routing.locales.map((l) => (
        <button
          key={l}
          onClick={() => switchTo(l)}
          className={
            "rounded px-2 py-1 uppercase transition-colors " +
            (l === locale
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
}
