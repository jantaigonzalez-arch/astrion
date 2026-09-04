import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";

// Contratos: vendedor y administrador.
export default async function ContractsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(await puedeEn("clientes", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }
  return <>{children}</>;
}
