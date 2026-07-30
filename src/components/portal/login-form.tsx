"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Loader2, LogIn } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useTranslations("portal.login");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError("Credenciales inválidas / Invalid credentials");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>

      <form onSubmit={onSubmit} className="mt-6 grid gap-4">
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("password")}</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="accent" size="lg" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {t("submit")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/contacto" className="font-medium text-primary hover:underline">
          {t("register")}
        </Link>
      </p>
    </div>
  );
}
