import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { Sidebar } from "@/components/portal/sidebar";
import { Topbar } from "@/components/portal/topbar";

export default async function PortalAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect({ href: "/login", locale });
  }

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <Sidebar role={session!.user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar name={session!.user.name} email={session!.user.email} />
          <main className="print-main flex-1 bg-background p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
