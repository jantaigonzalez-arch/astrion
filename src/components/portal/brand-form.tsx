"use client";

import { useActionState, useState } from "react";
import { Loader2, Upload, Trash2, AlertTriangle } from "lucide-react";
import { updateTenantBrand, type BrandState } from "@/lib/actions/brand";
import { TenantMark, type TenantBrand } from "@/components/portal/tenant-mark";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: BrandState = { ok: false };

/**
 * Marca de la empresa. Muestra en vivo cómo va a quedar, porque lo que se está
 * configurando es justamente algo que se ve — y el archivo que uno cree que
 * subió casi nunca es el que subió.
 */
export function BrandForm({
  brand,
  folioPrefix,
}: {
  brand: TenantBrand;
  folioPrefix: string;
}) {
  const [state, action, pending] = useActionState(updateTenantBrand, initial);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState(brand.brandName ?? "");
  const [prefijo, setPrefijo] = useState(folioPrefix);

  const shown: TenantBrand = {
    name: brand.name,
    brandName: name || null,
    logoUrl: preview ?? brand.logoUrl,
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Marca</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Es lo que ven tus clientes al entrar a su portal y en la barra lateral.
        Sin logo se usa un monograma con tu inicial.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Vista previa
        </p>
        <TenantMark brand={shown} />
      </div>

      <form action={action} className="mt-5 grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="brandName">Nombre corto</Label>
          <Input
            id="brandName"
            name="brandName"
            maxLength={60}
            value={name}
            placeholder={brand.name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">
            Opcional. Útil si la razón social es larga. Por omisión: {brand.name}
          </span>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="folioPrefix">Prefijo de folio</Label>
          <Input
            id="folioPrefix"
            name="folioPrefix"
            maxLength={8}
            value={prefijo}
            className="max-w-[10rem] font-mono uppercase"
            onChange={(e) => setPrefijo(e.target.value.toUpperCase())}
          />
          <span className="text-[11px] text-muted-foreground">
            Así se numeran tus tickets y negocios:{" "}
            <span className="font-mono text-foreground">
              {(prefijo || "—") + "-000123"}
            </span>
            {" · "}
            <span className="font-mono text-foreground">
              {(prefijo || "—") + "-D-000045"}
            </span>
          </span>
          <span className="flex items-start gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Cambiarlo no reescribe los folios ya emitidos: los tickets
            anteriores conservan el suyo y la numeración queda en dos series.
          </span>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="logo">Logo</Label>
          <Input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
          <span className="text-[11px] text-muted-foreground">
            PNG, JPG, WEBP o GIF, hasta 6 MB. Se ve mejor horizontal y con fondo
            transparente.
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Guardar
          </Button>

          {brand.logoUrl && (
            <Button
              type="submit"
              name="removeLogo"
              value="1"
              variant="outline"
              disabled={pending}
            >
              <Trash2 className="size-4" /> Quitar logo
            </Button>
          )}
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && state.message && (
          <p className="text-sm text-success">{state.message}</p>
        )}
      </form>
    </Card>
  );
}
