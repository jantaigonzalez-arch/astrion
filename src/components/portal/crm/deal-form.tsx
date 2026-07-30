"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Handshake, Loader2 } from "lucide-react";
import { createDeal, updateDeal, type CrmState } from "@/lib/actions/crm";
import { DEAL_SOURCES, SOURCE_LABELS, label } from "@/lib/crm";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: CrmState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type StageOption = { id: string; name: string; probability: number };
export type OwnerOption = { id: string; name: string | null; email: string };
export type OrgOption = { id: string; name: string };
export type ContactOption = {
  id: string;
  name: string;
  organizationId: string | null;
};

export type DealDefaults = {
  id?: string;
  title?: string;
  stageId?: string;
  organizationId?: string | null;
  contactId?: string | null;
  ownerId?: string | null;
  valueMxn?: string | null;
  valueUsd?: string | null;
  expectedCloseDate?: string | null;
  source?: string | null;
};

export function DealForm({
  pipelineId,
  stages,
  owners,
  organizations,
  contacts,
  locale,
  defaults,
  leadId,
}: {
  pipelineId: string;
  stages: StageOption[];
  owners: OwnerOption[];
  organizations: OrgOption[];
  contacts: ContactOption[];
  locale: string;
  defaults?: DealDefaults;
  leadId?: string;
}) {
  const editing = Boolean(defaults?.id);
  const router = useRouter();
  const [state, action, pending] = useActionState(
    editing ? updateDeal : createDeal,
    initial,
  );

  // Tras guardar una edición, vuelve a la ficha ya actualizada.
  const dealId = defaults?.id;
  useEffect(() => {
    if (state.ok && editing && dealId) router.push(`/admin/crm/negocios/${dealId}`);
  }, [state.ok, editing, dealId, router]);

  // Al elegir organización se filtran sus contactos (como en Pipedrive).
  const [orgId, setOrgId] = useState(defaults?.organizationId ?? "");
  const visibleContacts = orgId
    ? contacts.filter((c) => c.organizationId === orgId || !c.organizationId)
    : contacts;

  if (state.ok && !editing) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">Negocio creado</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {state.reference}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href={`/admin/crm/negocios/${state.id}`}>Abrir negocio</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/crm">Ver embudo</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}
      <input type="hidden" name="pipelineId" value={pipelineId} />
      {leadId && <input type="hidden" name="leadId" value={leadId} />}

      <div>
        <Label htmlFor="title">Título del negocio</Label>
        <Input
          id="title"
          name="title"
          required
          defaultValue={defaults?.title}
          placeholder="Ej. Contrato de mantenimiento HPLC — Lab Genoma"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="stageId">Etapa</Label>
          <select
            id="stageId"
            name="stageId"
            required
            className={selectCls}
            defaultValue={defaults?.stageId ?? stages[0]?.id}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.probability}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ownerId">Responsable comercial</Label>
          <select
            id="ownerId"
            name="ownerId"
            className={selectCls}
            defaultValue={defaults?.ownerId ?? ""}
          >
            <option value="">— Yo mismo —</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name ?? o.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="organizationId">Organización</Label>
          <select
            id="organizationId"
            name="organizationId"
            className={selectCls}
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            <option value="">— Sin organización —</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="contactId">Contacto</Label>
          <select
            id="contactId"
            name="contactId"
            className={selectCls}
            defaultValue={defaults?.contactId ?? ""}
          >
            <option value="">— Sin contacto —</option>
            {visibleContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="valueMxn">Valor (MXN)</Label>
          <Input
            id="valueMxn"
            name="valueMxn"
            inputMode="decimal"
            defaultValue={defaults?.valueMxn ?? ""}
            placeholder="185000"
          />
        </div>
        <div>
          <Label htmlFor="valueUsd">Valor (USD)</Label>
          <Input
            id="valueUsd"
            name="valueUsd"
            inputMode="decimal"
            defaultValue={defaults?.valueUsd ?? ""}
            placeholder="9800"
          />
        </div>
        <div>
          <Label htmlFor="expectedCloseDate">Cierre estimado</Label>
          <Input
            id="expectedCloseDate"
            name="expectedCloseDate"
            type="date"
            defaultValue={defaults?.expectedCloseDate ?? ""}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="source">Origen</Label>
        <select
          id="source"
          name="source"
          className={selectCls}
          defaultValue={defaults?.source ?? ""}
        >
          <option value="">— Sin especificar —</option>
          {DEAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {label(SOURCE_LABELS, s, locale)}
            </option>
          ))}
        </select>
      </div>

      {state.error === "invalid" && (
        <p className="text-sm text-destructive">
          Revisa el título, la etapa y los montos.
        </p>
      )}
      {state.error === "auth" && (
        <p className="text-sm text-destructive">
          Solo un perfil comercial puede gestionar negocios.
        </p>
      )}
      {state.error === "server" && (
        <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Handshake className="size-4" />
        )}
        {editing ? "Guardar cambios" : "Crear negocio"}
      </Button>
    </form>
  );
}
