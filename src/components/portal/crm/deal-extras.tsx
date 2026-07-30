"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Mail, Plus, Tag, Trash2 } from "lucide-react";
import { addDealItem, deleteDealItem, toggleDealLabel } from "@/lib/actions/crm-extras";
import { LABEL_STYLES, lineTotal, money, renderTemplate } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/* ------------------------- Líneas de producto ------------------------- */
export type DealItem = {
  id: string;
  name: string;
  quantity: string;
  unitPriceMxn: string;
  discountPct: string;
};

export type CatalogOptions = {
  products: { id: string; name: string }[];
  parts: {
    id: string;
    partNumber: string;
    description: string;
    priceMxn: string | null;
  }[];
};

export function DealItemsPanel({
  dealId,
  items,
  catalog,
  locale,
}: {
  dealId: string;
  items: DealItem[];
  catalog: CatalogOptions;
  locale: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const total = items.reduce((a, i) => a + lineTotal(i), 0);

  // Al elegir del catálogo se rellenan nombre y precio, pero siguen editables.
  function pickCatalog(value: string) {
    if (!value) return;
    const [kind, id] = value.split(":");
    if (kind === "product") {
      const p = catalog.products.find((x) => x.id === id);
      if (p) setName(p.name);
    } else {
      const p = catalog.parts.find((x) => x.id === id);
      if (p) {
        setName(`${p.partNumber} — ${p.description}`);
        if (p.priceMxn) setPrice(p.priceMxn);
      }
    }
  }

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Concepto</th>
                <th className="py-2 text-right font-medium">Cant.</th>
                <th className="py-2 text-right font-medium">P. unitario</th>
                <th className="py-2 text-right font-medium">Desc.</th>
                <th className="py-2 text-right font-medium">Importe</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-2">{i.name}</td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(i.quantity)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(i.unitPriceMxn, "MXN", locale)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(i.discountPct) > 0 ? `${Number(i.discountPct)}%` : "—"}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {money(String(lineTotal(i)), "MXN", locale)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <form
                      action={(fd) => startTransition(() => void deleteDealItem(fd))}
                    >
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="dealId" value={dealId} />
                      <button
                        type="submit"
                        aria-label="Quitar línea"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td colSpan={4} className="py-2 text-right font-medium">
                  Total
                </td>
                <td className="py-2 text-right font-mono font-semibold">
                  {money(String(total), "MXN", locale)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            El valor del negocio se actualiza con la suma de estas líneas.
          </p>
        </div>
      )}

      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            await addDealItem(fd);
            formRef.current?.reset();
            setName("");
            setPrice("");
          })
        }
        className="grid gap-3 rounded-xl border border-border bg-secondary/30 p-3"
      >
        <input type="hidden" name="dealId" value={dealId} />

        <select
          name="catalogRef"
          className={selectCls}
          defaultValue=""
          onChange={(e) => pickCatalog(e.target.value)}
          aria-label="Elegir del catálogo"
        >
          <option value="">— Del catálogo o escribe abajo —</option>
          {catalog.products.length > 0 && (
            <optgroup label="Productos">
              {catalog.products.map((p) => (
                <option key={p.id} value={`product:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {catalog.parts.length > 0 && (
            <optgroup label="Refacciones">
              {catalog.parts.map((p) => (
                <option key={p.id} value={`part:${p.id}`}>
                  {p.partNumber} — {p.description}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <Input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Concepto (servicio, equipo, refacción…)"
        />

        <div className="grid grid-cols-3 gap-2">
          <Input
            name="quantity"
            inputMode="decimal"
            defaultValue="1"
            aria-label="Cantidad"
            placeholder="Cant."
          />
          <Input
            name="unitPriceMxn"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-label="Precio unitario MXN"
            placeholder="Precio MXN"
          />
          <Input
            name="discountPct"
            inputMode="decimal"
            defaultValue="0"
            aria-label="Descuento porcentual"
            placeholder="% desc."
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Agregar línea
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------- Etiquetas ------------------------- */
export function LabelPicker({
  dealId,
  all,
  active,
}: {
  dealId: string;
  all: { id: string; name: string; color: string }[];
  active: string[];
}) {
  const [pending, startTransition] = useTransition();
  const set = new Set(active);

  if (all.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay etiquetas creadas. Se configuran en Embudos.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {all.map((l) => {
        const on = set.has(l.id);
        return (
          <form
            key={l.id}
            action={(fd) => startTransition(() => void toggleDealLabel(fd))}
          >
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="labelId" value={l.id} />
            <input type="hidden" name="attach" value={on ? "0" : "1"} />
            <button
              type="submit"
              disabled={pending}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-opacity",
                on
                  ? (LABEL_STYLES[l.color] ?? LABEL_STYLES.primary)
                  : "bg-transparent text-muted-foreground ring-border hover:bg-secondary",
              )}
            >
              <Tag className="mr-1 inline size-3" />
              {l.name}
            </button>
          </form>
        );
      })}
    </div>
  );
}

/* ------------------------- Correo con plantilla ------------------------- */
export function EmailComposer({
  templates,
  vars,
  to,
}: {
  templates: { id: string; name: string; subject: string; body: string }[];
  vars: {
    contacto?: string | null;
    organizacion?: string | null;
    negocio?: string | null;
    valor?: string | null;
    yo?: string | null;
  };
  to: string | null;
}) {
  const [id, setId] = useState("");

  if (!to) {
    return (
      <p className="text-xs text-muted-foreground">
        El contacto de este negocio no tiene correo registrado.
      </p>
    );
  }
  if (templates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No hay plantillas. Créalas en la pestaña Plantillas.
      </p>
    );
  }

  const tpl = templates.find((t) => t.id === id);
  // mailto: abre el cliente de correo del usuario con todo prellenado.
  const href = tpl
    ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
        renderTemplate(tpl.subject, vars),
      )}&body=${encodeURIComponent(renderTemplate(tpl.body, vars))}`
    : undefined;

  return (
    <div className="space-y-2">
      <select
        className={selectCls}
        value={id}
        onChange={(e) => setId(e.target.value)}
        aria-label="Plantilla de correo"
      >
        <option value="">— Elige una plantilla —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button asChild variant="outline" size="sm" disabled={!href} className="w-full">
        <a href={href ?? "#"} aria-disabled={!href}>
          <Mail className="size-4" /> Redactar correo
        </a>
      </Button>
    </div>
  );
}
