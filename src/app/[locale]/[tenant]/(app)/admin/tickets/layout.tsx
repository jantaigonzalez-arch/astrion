import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";

// La cola de tickets es solo para soporte (agente/admin): el vendedor no entra.
export default async function AdminTicketsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(await puedeEn("servicio", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }
  return <>{children}</>;
}
