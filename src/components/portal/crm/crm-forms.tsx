"use client";

import { useActionState } from "react";
import { Building2, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import {
  createContact,
  createOrganization,
  updateContact,
  updateOrganization,
  type CrmState,
} from "@/lib/actions/crm";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const initial: CrmState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type OwnerOption = { id: string; name: string | null; email: string };
export type ClientOption = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
};

/* ------------------------- Organización ------------------------- */
export type OrgDefaults = {
  id?: string;
  name?: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  ownerId?: string | null;
  clientId?: string | null;
  notes?: string | null;
};

export function OrganizationForm({
  owners,
  clients,
  defaults,
}: {
  owners: OwnerOption[];
  clients: ClientOption[];
  defaults?: OrgDefaults;
}) {
  const editing = Boolean(defaults?.id);
  const [state, action, pending] = useActionState(
    editing ? updateOrganization : createOrganization,
    initial,
  );

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-medium">
          {editing ? "Organización actualizada" : "Organización registrada"}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href={`/admin/crm/organizaciones/${state.id}`}>Ver ficha</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/crm/organizaciones">Ver todas</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Nombre del laboratorio / empresa</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name}
            placeholder="Ej. Laboratorios Genoma S.A. de C.V."
          />
        </div>
        <div>
          <Label htmlFor="industry">Giro</Label>
          <Input
            id="industry"
            name="industry"
            defaultValue={defaults?.industry ?? ""}
            placeholder="Farmacéutica, alimentos, ambiental…"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={defaults?.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="website">Sitio web</Label>
          <Input
            id="website"
            name="website"
            defaultValue={defaults?.website ?? ""}
            placeholder="https://…"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="address">Dirección</Label>
        <Textarea
          id="address"
          name="address"
          rows={2}
          defaultValue={defaults?.address ?? ""}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
        <div>
          <Label htmlFor="clientId">Cuenta de portal (si ya es cliente)</Label>
          <select
            id="clientId"
            name="clientId"
            className={selectCls}
            defaultValue={defaults?.clientId ?? ""}
          >
            <option value="">— Todavía no es cliente —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company ?? c.name ?? c.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notas</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults?.notes ?? ""}
          placeholder="Equipos instalados, historial, condiciones comerciales…"
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive">
          {state.error === "invalid"
            ? "Revisa los campos obligatorios."
            : state.error === "auth"
              ? "Solo un perfil comercial puede hacer esto."
              : "Ocurrió un error. Intenta de nuevo."}
        </p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Building2 className="size-4" />
        )}
        {editing ? "Guardar cambios" : "Registrar organización"}
      </Button>
    </form>
  );
}

/* ------------------------- Contacto ------------------------- */
export type ContactDefaults = {
  id?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  organizationId?: string | null;
  ownerId?: string | null;
  notes?: string | null;
};

export function ContactForm({
  owners,
  organizations,
  defaults,
}: {
  owners: OwnerOption[];
  organizations: { id: string; name: string }[];
  defaults?: ContactDefaults;
}) {
  const editing = Boolean(defaults?.id);
  const [state, action, pending] = useActionState(
    editing ? updateContact : createContact,
    initial,
  );

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-medium">
          {editing ? "Contacto actualizado" : "Contacto registrado"}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href="/admin/crm/contactos">Ver contactos</Link>
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            Registrar otro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name}
            placeholder="Ej. Q.F.B. Mariana Ruiz"
          />
        </div>
        <div>
          <Label htmlFor="position">Puesto</Label>
          <Input
            id="position"
            name="position"
            defaultValue={defaults?.position ?? ""}
            placeholder="Jefa de Control de Calidad"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults?.email ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={defaults?.phone ?? ""} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="organizationId">Organización</Label>
          <select
            id="organizationId"
            name="organizationId"
            className={selectCls}
            defaultValue={defaults?.organizationId ?? ""}
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

      <div>
        <Label htmlFor="notes">Notas</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults?.notes ?? ""}
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive">
          {state.error === "invalid"
            ? "Revisa el nombre y el formato del correo."
            : state.error === "auth"
              ? "Solo un perfil comercial puede hacer esto."
              : "Ocurrió un error. Intenta de nuevo."}
        </p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UserPlus className="size-4" />
        )}
        {editing ? "Guardar cambios" : "Registrar contacto"}
      </Button>
    </form>
  );
}
