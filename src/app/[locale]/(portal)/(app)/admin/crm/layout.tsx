import { auth } from "@/lib/auth";
import { isSalesRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { CrmTabs } from "@/components/portal/crm/crm-tabs";

// Guard: el CRM es del área comercial (vendedor y administrador).
export default async function CrmLayout({
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

  return (
    <div className="space-y-6">
      <CrmTabs isAdmin={session?.user?.role === "admin"} />
      {children}
    </div>
  );
}
