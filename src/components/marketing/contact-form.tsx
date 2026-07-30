"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { submitLead, type LeadFormState } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const initial: LeadFormState = { ok: false };

export function ContactForm() {
  const t = useTranslations("contact.form");
  const [state, formAction, pending] = useActionState(submitLead, initial);

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-10 text-center">
        <CheckCircle2 className="size-10 text-success" />
        <p className="font-medium">{t("success")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
      </div>
      <div>
        <Label htmlFor="company">{t("company")}</Label>
        <Input id="company" name="company" autoComplete="organization" />
      </div>
      <div>
        <Label htmlFor="message">{t("message")}</Label>
        <Textarea id="message" name="message" rows={5} required />
      </div>
      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        {t("submit")}
      </Button>
    </form>
  );
}
