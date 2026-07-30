import { getTranslations, setRequestLocale } from "next-intl/server";
import { Clock, Mail, MapPin, Phone, Wrench } from "lucide-react";
import { PageHeader } from "@/components/marketing/page-header";
import { ContactForm } from "@/components/marketing/contact-form";
import { Container } from "@/components/ui/container";

export default async function ContactoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("subtitle")} />
      <Container className="py-20">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          {/* Info */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3.5 py-1.5 text-sm font-medium text-signal-bright">
              <Clock className="size-4" /> {t("form.success").split("!")[0]}
            </div>

            <ul className="space-y-5 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 text-primary" />
                <span>{t("address")}</span>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 size-5 text-primary" />
                <div>
                  <div className="text-muted-foreground">{t("sales")}</div>
                  <a className="hover:text-primary" href="mailto:ventas@evoelution.com">ventas@evoelution.com</a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Wrench className="mt-0.5 size-5 text-primary" />
                <div>
                  <div className="text-muted-foreground">{t("service")}</div>
                  <a className="hover:text-primary" href="mailto:servicio@evoelution.com">servicio@evoelution.com</a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 size-5 text-primary" />
                <div>
                  <div className="text-muted-foreground">{t("phone")}</div>
                  <a className="hover:text-primary" href="tel:+525555902555">(+52) 55 5590 2555</a>
                </div>
              </li>
            </ul>
          </div>

          {/* Formulario */}
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <ContactForm />
          </div>
        </div>
      </Container>
    </>
  );
}
