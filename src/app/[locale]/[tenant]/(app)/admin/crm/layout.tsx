import { isSalesRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { CrmTabs } from "@/components/portal/crm/crm-tabs";
import { currentRole } from "@/lib/tenancy/context";

// Guard: el CRM es del área comercial (vendedor y administrador).
export default async function CrmLayout({
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

  return (
    <div className="space-y-6">
      <CrmTabs />
      {children}
    </div>
  );
}
