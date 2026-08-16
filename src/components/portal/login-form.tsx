"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Loader2, LogIn } from "lucide-react";
import { Link, useRouter } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * @param destination A dónde ir tras firmar.
 *
 * Lo decide la PUERTA por la que se entró, no el rol de quien entra. Desde
 * `/evoelution/acceso` se cae en el portal de Evoelution aunque seas
 * superadministrador de Astraion: entraste por la puerta de esa empresa y ahí
 * es donde ibas. Solo la puerta genérica (`/login`) delega en `/entrar`, que
 * sí reparte por rol.
 */
export function LoginForm({
  destination = "/entrar",
  brand = "tenant",
}: {
  destination?: string;
  /**
   * De quién es la puerta.
   *
   * `tenant` habla de tickets y soporte, que es lo que viene a hacer quien
   * entra al portal de su laboratorio. `astraion` habla del producto, porque
   * en `astraion.com/login` quien llega puede ser de cualquier empresa —o de
   * ninguna todavía—. Recibirlo con el texto de un cliente le dice que se
   * equivocó de sitio, igual que hacía el logo.
   */
  brand?: "tenant" | "astraion";
}) {
  const t = useTranslations(brand === "astraion" ? "portal.loginAstraion" : "portal.login");
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
    if (res?.error) {
      setPending(false);
      setError("Credenciales inválidas / Invalid credentials");
      return;
    }

    setPending(false);
    // `useRouter` de @/lib/nav le pone el prefijo de la empresa cuando toca:
    // desde `/evoelution/acceso`, "/dashboard" acaba en `/evoelution/dashboard`.
    router.push(destination);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>

      {/* `method="post"` no lo usa el camino normal —`onSubmit` lo intercepta
          con `preventDefault`— y por eso mismo es importante. Un formulario sin
          `method` envía por GET, así que cualquier cosa que impida hidratar
          (JS bloqueado, un error en el bundle, un clic antes de tiempo) manda
          la CONTRASEÑA en la barra de direcciones, donde queda guardada en el
          historial y en los registros del servidor. Ocurrió de verdad probando
          el modo subdominio en desarrollo. El POST no autentica, pero falla
          sin filtrar nada. */}
      <form onSubmit={onSubmit} method="post" className="mt-6 grid gap-4">
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
        <Link
          href={brand === "astraion" ? "/#alta" : "/contacto"}
          className="font-medium text-primary hover:underline"
        >
          {t("register")}
        </Link>
      </p>
    </div>
  );
}
