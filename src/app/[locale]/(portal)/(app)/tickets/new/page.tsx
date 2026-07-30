import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getEquipmentTree } from "@/lib/data/equipment";
import { Card } from "@/components/ui/card";
import { NewTicketForm } from "@/components/portal/new-ticket-form";

export default async function NewTicketPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El cliente elige entre SUS equipos registrados.
  const session = await auth();
  const tree = await getEquipmentTree(session!.user.id);
  const equipment = tree.map((eq) => ({
    id: eq.id,
    brand: eq.brand,
    name: eq.name,
    model: eq.model,
    modules: eq.modules.map((m) => ({
      id: m.id,
      brand: m.brand,
      name: m.name,
      serialNumber: m.serialNumber,
    })),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo ticket</h1>
        <p className="text-sm text-muted-foreground">
          Cuéntanos qué necesitas. Respuesta remota en menos de 2 horas.
        </p>
      </div>
      <Card className="p-6 sm:p-8">
        <NewTicketForm locale={locale} equipment={equipment} />
      </Card>
    </div>
  );
}
