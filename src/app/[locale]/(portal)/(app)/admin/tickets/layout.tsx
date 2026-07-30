import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";

// La cola de tickets es solo para soporte (agente/admin): el vendedor no entra.
export default async function AdminTicketsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!isSupport(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }
  return <>{children}</>;
}
