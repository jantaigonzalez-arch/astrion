import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/shared/logo";
import { LoginForm } from "@/components/portal/login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-[720px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />

      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-2xl shadow-primary/5 backdrop-blur">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
