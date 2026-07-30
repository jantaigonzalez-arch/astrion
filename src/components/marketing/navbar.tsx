"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";

export function Navbar() {
  const t = useTranslations("nav");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: "/nosotros", label: t("about") },
    { href: "/servicios", label: t("services") },
    { href: "/evo-ai", label: t("evoAi") },
    { href: "/productos", label: t("products") },
    { href: "/marcas", label: t("brands") },
    { href: "/contacto", label: t("contact") },
  ] as const;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "glass border-b border-border/60 shadow-sm"
          : "bg-transparent",
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="Evoelution" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">{t("login")}</Link>
          </Button>
          <Button asChild variant="accent" size="sm">
            <Link href="/contacto">{t("requestService")}</Link>
          </Button>
        </div>

        <button
          className="inline-flex size-9 items-center justify-center rounded-md border border-border md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menú"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </Container>

      {open && (
        <div className="glass border-t border-border/60 md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/login" onClick={() => setOpen(false)}>
                  {t("login")}
                </Link>
              </Button>
              <Button asChild variant="accent" size="sm">
                <Link href="/contacto" onClick={() => setOpen(false)}>
                  {t("requestService")}
                </Link>
              </Button>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
