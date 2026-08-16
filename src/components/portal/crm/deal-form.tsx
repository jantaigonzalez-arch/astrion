"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Handshake,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  createDeal,
  createOrganization,
  updateDeal,
  type CrmState,
} from "@/lib/actions/crm";
import {
  DEAL_SOURCES,
  ORG_KIND_LABELS,
  ORG_KIND_STYLES,
  SOURCE_LABELS,
  label,
  type OrgKind,
} from "@/lib/crm";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { OrgPicker } from "@/components/portal/crm/org-picker";
import { cn } from "@/lib/utils";

const initial: CrmState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type StageOption = { id: string; name: string; probability: number };
export type OwnerOption = { id: string; name: string | null; email: string };
export type OrgOption = {
  id: string;
  name: string;
  kind: OrgKind;
  /** Con qué se puede buscar además del nombre. Ver `getOrgOptions`. */
  taxId?: string | null;
  industry?: string | null;
  phone?: string | null;
  openDeals?: number;
  wonDeals?: number;
};
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

  // La lista vive en estado, no en las props, porque puede crecer sin recargar:
  // el panel de «Crear nueva» le añade una y la deja seleccionada.
  const [orgs, setOrgs] = useState(organizations);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  // Lo tecleado en el buscador cuando no hubo resultado: arranca el alta.
  const [newOrgName, setNewOrgName] = useState("");
  const selectedOrg = orgs.find((o) => o.id === orgId) ?? null;

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
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="organizationId">Organización</Label>
            {!creating && (
              <button
                type="button"
                onClick={() => {
                  setNewOrgName("");
                  setCreating(true);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="size-3" /> Crear nueva
              </button>
            )}
          </div>

          {/*
            El valor viaja en un campo oculto y el visible es un BOTÓN.

            Aquí había un `<select>` con las 164 organizaciones agrupadas en
            Clientes y Leads. Agrupar ayudaba, pero el control seguía siendo una
            tira sin búsqueda y sin más dato que el nombre: para dar con
            «PROCTER & GAMBLE MANUFACTURA S. DE R.L. DE C.V.» había que acertar
            la razón social de memoria o desplazarse a ojo. Lo que hacía falta
            no era ordenar mejor la lista, era poder buscar en ella.
          */}
          <input type="hidden" name="organizationId" value={orgId} />

          <button
            type="button"
            id="organizationId"
            onClick={() => setPicking(true)}
            className={cn(
              selectCls,
              "items-center justify-between gap-2 text-left hover:bg-secondary/40",
            )}
          >
            {selectedOrg ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{selectedOrg.name}</span>
                <Badge className={cn("shrink-0", ORG_KIND_STYLES[selectedOrg.kind])}>
                  {label(ORG_KIND_LABELS, selectedOrg.kind, locale)}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Buscar o elegir organización…
              </span>
            )}
            <Search className="size-4 shrink-0 text-muted-foreground" />
          </button>

          <OrgPicker
            orgs={orgs}
            value={orgId}
            onPick={setOrgId}
            onCreateNew={(name) => {
              setNewOrgName(name);
              setCreating(true);
            }}
            locale={locale}
            open={picking}
            onClose={() => setPicking(false)}
          />

          {selectedOrg && !creating && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3" />
              {selectedOrg.kind === "client"
                ? "Ya es cliente: tiene compras, contrato o cuenta de portal."
                : "Todavía es un lead: no tiene ninguna compra registrada."}
            </p>
          )}

          {creating && (
            <NewOrgPanel
              initialName={newOrgName}
              existing={orgs}
              onCancel={() => setCreating(false)}
              onCreated={(org) => {
                // Se añade a la lista en memoria y queda elegida. Sin recargar:
                // volver a pedir la página perdería lo que ya se escribió del
                // negocio, que es justo lo que este panel viene a evitar.
                setOrgs((prev) => [...prev, org]);
                setOrgId(org.id);
                setCreating(false);
              }}
            />
          )}
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

/**
 * Alta de organización sin salir del formulario del negocio.
 *
 * **No es un `<form>`**, y esa es la decisión que manda sobre todo lo demás:
 * este panel se dibuja DENTRO del formulario del negocio, y anidar formularios
 * es HTML inválido — el navegador cierra el interno por su cuenta y el botón
 * termina enviando el negocio a medio capturar. Por eso los botones son
 * `type="button"` y la acción de servidor se invoca a mano.
 *
 * La tecla Enter recibe el mismo trato explícito: dentro de un formulario,
 * Enter en un campo de texto envía el formulario que lo contiene. Sin
 * interceptarla, teclear el nombre y pulsar Enter —lo más natural del mundo—
 * crearía el NEGOCIO en vez de la organización.
 *
 * Solo se piden nombre y giro. La ficha completa —RFC, dirección, cuenta de
 * portal, responsable— se llena después en su pantalla; aquí lo único que hace
 * falta es poder seguir capturando el negocio, y cada campo de más es una razón
 * para abandonar a medias.
 */
function NewOrgPanel({
  onCreated,
  onCancel,
  existing,
  initialName = "",
}: {
  onCreated: (org: OrgOption) => void;
  onCancel: () => void;
  existing: OrgOption[];
  /** Lo que se buscó sin encontrarlo, para no teclearlo dos veces. */
  initialName?: string;
}) {
  const [name, setName] = useState(initialName);
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Aviso, no bloqueo: puede haber dos laboratorios con nombre parecido en
  // ciudades distintas. Pero duplicar una organización es de lo más caro de
  // deshacer en un CRM —los negocios quedan repartidos entre las copias—, así
  // que vale la pena decirlo antes y no descubrirlo en el informe.
  const norm = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const duplicate = name.trim()
    ? (existing.find((o) => norm(o.name) === norm(name)) ?? null)
    : null;

  function submit() {
    if (!name.trim() || saving) return;
    setError(null);

    startSaving(async () => {
      const fd = new FormData();
      fd.set("name", name.trim());
      if (industry.trim()) fd.set("industry", industry.trim());

      // Sin `ownerId`: la acción lo resuelve como «yo mismo» y valida la
      // membresía (ver `resolveOwner`). Mandar uno desde aquí sería inventar
      // una regla distinta de la que usa el resto del CRM.
      const r = await createOrganization({ ok: false }, fd);

      if (!r.ok || !r.id) {
        setError(
          r.error === "auth"
            ? "No tienes permiso para crear organizaciones."
            : r.error === "invalid"
              ? "Revisa el nombre: necesita al menos 2 caracteres."
              : "No se pudo crear. Intenta de nuevo.",
        );
        return;
      }

      // Nace como lead por definición: todavía no compró nada. En cuanto se
      // gane este negocio pasará sola a Clientes — ver `ES_CLIENTE`.
      onCreated({ id: r.id, name: name.trim(), kind: "lead" });
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold">Nueva organización</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancelar la creación de organización"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Nombre del laboratorio o empresa"
          aria-label="Nombre de la nueva organización"
          autoFocus
        />
        <Input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Giro (opcional) — ej. Farmacéutica"
          aria-label="Giro de la nueva organización"
        />
      </div>

      {duplicate && (
        <p className="mt-2 text-xs text-warning">
          Ya existe «{duplicate.name}». Si es la misma, cierra esto y elígela de
          la lista.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="accent"
          size="sm"
          onClick={submit}
          disabled={!name.trim() || saving}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Crear y elegir
        </Button>
      </div>
    </div>
  );
}
