import { useTranslations } from "next-intl";
import { Mail, MapPin, Phone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/shared/logo";
import { Container } from "@/components/ui/container";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const c = useTranslations("contact");
  const year = 2026;

  return (
    <footer className="mt-24 border-t border-border bg-secondary/40">
      <Container className="grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            {t("tagline")}
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold">{t("sections.company")}</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li><Link className="hover:text-foreground" href="/nosotros">{nav("about")}</Link></li>
            <li><Link className="hover:text-foreground" href="/servicios">{nav("services")}</Link></li>
            <li><Link className="hover:text-foreground" href="/marcas">{nav("brands")}</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold">{t("sections.services")}</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li><Link className="hover:text-foreground" href="/evo-ai">{nav("evoAi")}</Link></li>
            <li><Link className="hover:text-foreground" href="/productos">{nav("products")}</Link></li>
            <li><Link className="hover:text-foreground" href="/login">{nav("portal")}</Link></li>
            <li><Link className="hover:text-foreground" href="/contacto">{nav("contact")}</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold">{t("sections.contact")}</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0" /> {c("address")}
            </li>
            <li className="flex items-center gap-2">
              <Mail className="size-4 shrink-0" />
              <a className="hover:text-foreground" href="mailto:ventas@evoelution.com">ventas@evoelution.com</a>
            </li>
            <li className="flex items-center gap-2">
              <Phone className="size-4 shrink-0" />
              <a className="hover:text-foreground" href="tel:+525555902555">(+52) 55 5590 2555</a>
            </li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-border">
        <Container className="flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} Evoelution. {t("rights")}</p>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-foreground">{t("privacy")}</Link>
            <Link href="/" className="hover:text-foreground">{t("terms")}</Link>
          </div>
        </Container>
      </div>
    </footer>
  );
}
