import { isInternal } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";

// Guard: solo agentes y administradores pueden entrar a /admin/*.
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Perfiles internos (agente, admin, vendedor). Cada sección afina su permiso.
  if (!isInternal(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }
  return <>{children}</>;
}
