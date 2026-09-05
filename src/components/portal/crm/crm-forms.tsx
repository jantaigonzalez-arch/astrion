"use client";

import { useActionState, useState } from "react";
import {
  SLA_HORAS_MAX,
  SLA_HORAS_MIN,
  SLA_HOURS,
} from "@/lib/tickets";
import { Building2, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import {
  createContact,
  createOrganization,
  updateContact,
  updateOrganization,
  type CrmState,
} from "@/lib/actions/crm";
import { ESTADOS_MX } from "@/lib/domicilio";
import { avisoDelTelefono, telefonoLegible } from "@/lib/telefono";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";

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
  /** El domicilio de siempre, en una línea. Ver el bloque fiscal de abajo. */
  address?: string | null;
  /* Domicilio desarmado como el nodo `Domicilio` del SAT. Ver `lib/domicilio.ts`. */
  street?: string | null;
  extNumber?: string | null;
  intNumber?: string | null;
  neighborhood?: string | null;
  municipality?: string | null;
  state?: string | null;
  postalCode?: string | null;
  addressReference?: string | null;
  ownerId?: string | null;
  clientId?: string | null;
  /** Plazo propio de primera respuesta, en horas. Nulo = el general. */
  slaHours?: number | null;
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
            <Link href={`/admin/organizaciones/${state.id}`}>Ver ficha</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/organizaciones">Ver todas</Link>
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
        <CampoTelefono id="phone" defaultValue={defaults?.phone ?? ""} />
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

      {/*
        ── EL DOMICILIO, DESARMADO COMO LO PIDE EL SAT ────────────────────────

        Y el código postal PRIMERO, que es el orden contrario al que uno dicta
        una dirección. Es deliberado: de todo este bloque, el CP es el único dato
        que el CFDI 4.0 exige del receptor —`DomicilioFiscalReceptor`— y el que
        más rechazos causa al timbrar, porque tiene que ser idéntico al de la
        Constancia de Situación Fiscal. Ponerlo al final, entre calle y colonia,
        lo convertía en un campo más que se llena de memoria.

        Todo lo demás es opcional de verdad: a un prospecto al que solo se le va
        a llamar no se le pide domicilio fiscal.
      */}
      <fieldset className="rounded-xl border border-border p-4">
        <legend className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Domicilio fiscal
        </legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="postalCode">
              Código postal <span className="text-primary">·</span>
            </Label>
            <Input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              maxLength={5}
              pattern="\d{5}"
              defaultValue={defaults?.postalCode ?? ""}
              placeholder="04650"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Cinco dígitos, igual que en su Constancia de Situación Fiscal. Es el
              único dato del domicilio que viaja en la factura.
            </p>
          </div>
          <div>
            <Label htmlFor="state">Estado</Label>
            {/* Treinta y dos estados: por encima del umbral, así que se
                teclea «yuc» en vez de rodar la lista entera. */}
            <Selector
              id="state"
              name="state"
              defaultValue={defaults?.state ?? ""}
              placeholder="— Sin especificar —"
              opciones={ESTADOS_MX.map((e) => ({ value: e, label: e }))}
            />
          </div>
          <div>
            <Label htmlFor="municipality">Municipio o alcaldía</Label>
            <Input
              id="municipality"
              name="municipality"
              defaultValue={defaults?.municipality ?? ""}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="street">Calle</Label>
            <Input id="street" name="street" defaultValue={defaults?.street ?? ""} />
          </div>
          <div>
            {/* Texto y no número: «S/N», «12-A» y «KM 4.5» son domicilios reales. */}
            <Label htmlFor="extNumber">Núm. exterior</Label>
            <Input
              id="extNumber"
              name="extNumber"
              defaultValue={defaults?.extNumber ?? ""}
              placeholder="78 · S/N"
            />
          </div>
          <div>
            <Label htmlFor="intNumber">Núm. interior</Label>
            <Input
              id="intNumber"
              name="intNumber"
              defaultValue={defaults?.intNumber ?? ""}
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="neighborhood">Colonia</Label>
            <Input
              id="neighborhood"
              name="neighborhood"
              defaultValue={defaults?.neighborhood ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="addressReference">Referencia</Label>
            <Input
              id="addressReference"
              name="addressReference"
              defaultValue={defaults?.addressReference ?? ""}
              placeholder="Entre qué calles, seña para llegar"
            />
          </div>
        </div>

        {/*
          El texto de origen sigue aquí, y por una razón: 148 fichas llegaron con
          el domicilio en una sola línea desde el padrón anterior, y lo que el
          desarmado no supo colocar sigue estando en este campo. Se enseña al
          final, plegado, para poder comparar sin que estorbe.
        */}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Domicilio tal como se capturó
          </summary>
          <Textarea
            id="address"
            name="address"
            rows={2}
            className="mt-2"
            defaultValue={defaults?.address ?? ""}
          />
        </details>
      </fieldset>

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
          {/*
            Este campo enlaza la cuenta con la que el cliente entra al portal.
            NO es lo que decide si la organización es cliente.

            Antes decía «si ya es cliente» y «— Todavía no es cliente —», y eso
            dejó de ser cierto: cliente es quien tiene un negocio ganado, un
            contrato firmado **o** cuenta de portal (ver `ES_CLIENTE`). Hay al
            menos un caso real —Laboratorios Genoma, cliente por negocio
            ganado— donde la etiqueta vieja afirmaba lo contrario de lo que la
            propia pantalla de Clientes muestra.

            Lo que sí depende de este campo es poder VER sus equipos y sus
            tickets, porque cuelgan de esa cuenta y no de la organización.
          */}
          <Label htmlFor="clientId">Cuenta de portal</Label>
          <Selector
            id="clientId"
            name="clientId"
            defaultValue={defaults?.clientId ?? ""}
            placeholder="— Sin cuenta de portal —"
            opciones={clients.map((c) => ({
              value: c.id,
              label: c.company ?? c.name ?? c.email,
              detalle: c.company ? (c.name ?? c.email) : null,
              buscar: c.email,
            }))}
          />
        </div>
      </div>

      {/*
        EL PLAZO PACTADO CON ESTE CLIENTE.

        Debajo de la cuenta de portal y no arriba con los datos de contacto: es
        una condición del acuerdo, no una señas de la empresa.

        Vacío es lo NORMAL y el texto lo dice con todas las letras, porque el
        malentendido caro sería leer el campo en blanco como «este cliente no
        tiene compromiso». Tiene el general; lo que no tiene es uno propio.
      */}
      <div>
        <Label htmlFor="slaHours">Primera respuesta comprometida</Label>
        <div className="mt-1 flex items-center gap-2">
          <Input
            id="slaHours"
            name="slaHours"
            type="number"
            min={SLA_HORAS_MIN}
            max={SLA_HORAS_MAX}
            step={1}
            className="w-28"
            defaultValue={defaults?.slaHours ?? ""}
            placeholder={String(SLA_HOURS)}
          />
          <span className="text-sm text-muted-foreground">horas</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Solo si este cliente pactó un plazo distinto. Déjalo vacío y se le
          aplica el general de{" "}
          <span className="font-medium text-foreground">{SLA_HOURS} horas</span>.
          Se usa al levantar cada ticket y queda fijado en él: cambiarlo aquí no
          mueve el vencimiento de los que ya entraron.
        </p>
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
        <CampoTelefono id="phone" defaultValue={defaults?.phone ?? ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="organizationId">Organización</Label>
          <Selector
            id="organizationId"
            name="organizationId"
            defaultValue={defaults?.organizationId ?? ""}
            placeholder="— Sin organización —"
            opciones={organizations.map((o) => ({ value: o.id, label: o.name }))}
          />
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

/**
 * EL CAMPO DE TELÉFONO, CON ESPEJO DEBAJO.
 *
 * Mientras se escribe, dice cómo va a quedar guardado y leído: «55 5590 2555»,
 * «800 503 0909», «2789 2000 ext. 1112». No corrige el campo mientras uno teclea
 * —reescribir bajo los dedos es la forma más rápida de que alguien pelee con un
 * formulario— sino que enseña el resultado al lado.
 *
 * ── EL AVISO ES EL PUNTO ──────────────────────────────────────────────────
 *
 * De los 68 teléfonos cargados, 32 tienen ocho dígitos: son de antes de 2019,
 * cuando la Ciudad de México marcaba sin lada, y hoy no se pueden marcar. El
 * sistema no les inventa el «55» —una lada equivocada hace llamar a un
 * desconocido—, así que la única forma de que se arreglen es que quien tenga la
 * ficha abierta lo vea. Aquí lo ve, en el momento en que puede preguntarlo.
 */
function CampoTelefono({
  id,
  defaultValue,
}: {
  id: string;
  defaultValue: string;
}) {
  const [valor, setValor] = useState(defaultValue);
  const legible = telefonoLegible(valor);
  const aviso = avisoDelTelefono(valor);

  return (
    <div>
      <Label htmlFor={id}>Teléfono</Label>
      <Input
        id={id}
        name={id}
        type="tel"
        inputMode="tel"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="55 5590 2555"
      />
      {legible && (
        <p className="mt-1 text-[11px]">
          {aviso ? (
            <span className="text-warning">
              {legible} — {aviso}
            </span>
          ) : (
            <span className="text-muted-foreground">Se guardará como {legible}</span>
          )}
        </p>
      )}
    </div>
  );
}
