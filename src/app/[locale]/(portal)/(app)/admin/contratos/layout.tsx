import { auth } from "@/lib/auth";
import { isSalesRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";

// Contratos: vendedor y administrador.
export default async function ContractsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!isSalesRole(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }
  return <>{children}</>;
}
