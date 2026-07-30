import { auth } from "@/lib/auth";
import { isInternal } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";

// Guard: solo agentes y administradores pueden entrar a /admin/*.
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  // Perfiles internos (agente, admin, vendedor). Cada sección afina su permiso.
  if (!isInternal(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }
  return <>{children}</>;
}
