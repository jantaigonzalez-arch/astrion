import { isSalesRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";

// Contratos: vendedor y administrador.
export default async function ContractsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSalesRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }
  return <>{children}</>;
}
