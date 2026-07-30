import { setRequestLocale } from "next-intl/server";
import { Boxes } from "lucide-react";
import { Card } from "@/components/ui/card";

export default async function AdminCatalogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catálogo</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de servicios, productos y marcas del sitio (CMS).
        </p>
      </div>
      <Card className="flex flex-col items-center gap-3 border-dashed p-12 text-center">
        <Boxes className="size-10 text-primary" />
        <p className="max-w-md text-sm text-muted-foreground">
          El editor de contenido (servicios, productos y marcas) se conecta a las
          tablas <code className="font-mono">services</code>,{" "}
          <code className="font-mono">products</code> y{" "}
          <code className="font-mono">brands</code>. Próxima iteración.
        </p>
      </Card>
    </div>
  );
}
