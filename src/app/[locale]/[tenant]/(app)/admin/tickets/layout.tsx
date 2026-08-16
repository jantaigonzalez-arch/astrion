import { isSupport } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";

// La cola de tickets es solo para soporte (agente/admin): el vendedor no entra.
export default async function AdminTicketsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupport(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }
  return <>{children}</>;
}
