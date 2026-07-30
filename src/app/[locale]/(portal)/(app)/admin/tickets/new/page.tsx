import { setRequestLocale } from "next-intl/server";
import { getClientsWithEquipment } from "@/lib/data/equipment";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ServiceTicketForm } from "@/components/portal/service-ticket-form";

export default async function NewServiceTicketPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const raw = await getClientsWithEquipment();
  const clients = raw.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company,
    equipment: c.equipment.map((eq) => ({
      id: eq.id,
      brand: eq.brand,
      name: eq.name,
      model: eq.model,
      modules: eq.modules.map((m) => ({
        id: m.id,
        name: m.name,
        serialNumber: m.serialNumber,
      })),
    })),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Levantamiento de servicio
          </h1>
          <p className="text-sm text-muted-foreground">
            Creado por el equipo — entra directo a la cola, sin revisión.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/tickets">← Cola</Link>
        </Button>
      </div>
      <Card className="p-6 sm:p-8">
        <ServiceTicketForm locale={locale} clients={clients} />
      </Card>
    </div>
  );
}
